"""Functional API checks using an isolated temporary database (never demo data)."""
import importlib.util,json,tempfile,threading,unittest,urllib.request,urllib.error,http.cookiejar
from pathlib import Path
spec=importlib.util.spec_from_file_location('medico',Path(__file__).parents[1]/'server/app.py');app=importlib.util.module_from_spec(spec);spec.loader.exec_module(app)
class Client:
 def __init__(self,base):self.base=base;self.csrf='';self.http=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
 def request(self,path,body=None,csrf=True):
  req=urllib.request.Request(self.base+'/api/'+path,data=json.dumps(body).encode() if body is not None else None,headers={'Content-Type':'application/json','X-CSRF-Token':self.csrf if csrf else ''})
  try:
   with self.http.open(req) as r:return r.status,json.load(r)
  except urllib.error.HTTPError as e:return e.code,json.load(e)
 def login(self,email):
  status,d=self.request('login',{'email':email,'password':'MedicoDemo24!','role':'doctor' if email.strip().lower()=='sarah@demo.medico' else 'patient'});assert status==200;self.csrf=d['user']['csrf']
class ApiTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.temp=tempfile.TemporaryDirectory();app.DB=Path(cls.temp.name)/'test.db';app.init();cls.server=app.ThreadingHTTPServer(('127.0.0.1',0),app.Handler);threading.Thread(target=cls.server.serve_forever,daemon=True).start();cls.base='http://127.0.0.1:'+str(cls.server.server_port)
 @classmethod
 def tearDownClass(cls):cls.server.shutdown();cls.server.server_close();cls.temp.cleanup()
 def setUp(self):
  app.LOGIN_ATTEMPTS.clear();self.p=Client(self.base);self.d=Client(self.base);self.p.login('alex@demo.medico');self.d.login('sarah@demo.medico');self.p.request('consent',{'enabled':True})
 def test_unauthenticated_and_bad_login(self):
  c=Client(self.base);self.assertEqual(c.request('dashboard')[0],401);self.assertEqual(c.request('login',{'email':'alex@demo.medico','password':'wrong','role':'patient'})[0],401)
 def test_portal_role_is_enforced_at_login(self):
  c=Client(self.base);self.assertEqual(c.request('login',{'email':'alex@demo.medico','password':'MedicoDemo24!','role':'doctor'})[0],403);self.assertEqual(c.request('me')[0],401)
 def test_both_portals_and_normalized_email(self):
  self.assertEqual(self.p.request('me')[1]['user']['role'],'patient');self.assertEqual(self.d.request('me')[1]['user']['role'],'doctor');c=Client(self.base);c.login('  ALEX@DEMO.MEDICO  ');self.assertEqual(c.request('dashboard')[0],200)
 def test_csrf_and_role_enforcement(self):
  self.assertEqual(self.p.request('consent',{'enabled':False},csrf=False)[0],403);self.assertEqual(self.p.request('record',{'title':'x','detail':'x'})[0],403);self.assertEqual(self.d.request('consent',{'enabled':False})[0],403)
 def test_revocation_blocks_all_doctor_access(self):
  self.p.request('consent',{'enabled':False});self.assertEqual(self.d.request('dashboard')[0],403);self.assertEqual(self.d.request('audit')[0],403);self.assertEqual(self.d.request('emergency',{'patientId':'DM-00241','verified':True,'reason':'test'})[0],403);self.assertEqual(self.p.request('dashboard')[0],200)
 def test_prescription_and_adherence(self):
  self.assertEqual(self.d.request('medicine',{'name':'Test Rx','dose':'synthetic','timing':'25:00'})[0],400);self.assertEqual(self.d.request('medicine',{'name':'Test Rx','dose':'synthetic','timing':'09:00'})[0],200)
  meds=self.p.request('dashboard')[1]['medicines'];mid=next(m['id'] for m in meds if m['name']=='Test Rx');self.assertEqual(self.p.request('medicine',{'id':mid,'status':'taken'})[0],200);self.assertEqual(next(m['status'] for m in self.d.request('dashboard')[1]['medicines'] if m['id']==mid),'taken')
 def test_record_and_emergency_audit(self):
  self.assertEqual(self.d.request('record',{'title':'Follow-up','detail':'Synthetic note'})[0],200);self.assertTrue(any(r['title']=='Follow-up' for r in self.p.request('dashboard')[1]['records']));self.assertEqual(self.d.request('emergency',{'patientId':'wrong','verified':True,'reason':'test'})[0],400);self.assertEqual(self.d.request('emergency',{'patientId':'DM-00241','verified':True,'reason':'Emergency demo'})[0],200);self.assertTrue(any('Emergency record access' in a['action'] for a in self.p.request('audit')[1]['audit']))
 def test_chat_escalation_and_clinician_reply(self):
  code,d=self.p.request('chat',{'question':'I have chest pain'});self.assertEqual(code,200);self.assertEqual(d['status'],'pending');self.assertIn('emergency number',d['answer']);mid=self.d.request('dashboard')[1]['messages'][0]['id'];self.assertEqual(self.d.request('reply',{'id':mid,'answer':'Seek emergency assessment.'})[0],200);self.assertEqual(self.p.request('dashboard')[1]['messages'][0]['status'],'reviewed')
 def test_registration_and_patient_isolation(self):
  other=Client(self.base);code,d=other.request('register',{'role':'patient','name':'Jamie Demo','email':'jamie@demo.medico','password':'PrivateDemo24!','consent':True});self.assertEqual(code,200);other.csrf=d['user']['csrf'];uid=d['user']['id']
  self.assertEqual(other.request('dashboard')[1]['records'],[]);self.assertEqual(other.request('dashboard?patient=p1')[0],403);self.assertEqual(self.p.request('dashboard?patient='+uid)[0],403)
  medication=self.p.request('dashboard')[1]['medicines'][0]['id'];self.assertEqual(other.request('medicine',{'id':medication,'status':'taken'})[0],404)
  self.assertEqual(self.d.request('record?patient='+uid,{'title':'Jamie only','detail':'Synthetic separate record'})[0],200);self.assertEqual(other.request('dashboard')[1]['records'][0]['title'],'Jamie only');self.assertFalse(any(r['title']=='Jamie only' for r in self.p.request('dashboard')[1]['records']))
  other.request('consent',{'enabled':False});self.assertEqual(self.d.request('dashboard?patient='+uid)[0],403)
 def test_clinical_questions_stay_private_without_consent(self):
  self.p.request('consent',{'enabled':False});status,d=self.p.request('chat',{'question':'I have severe chest pain'});self.assertEqual(status,200);self.assertEqual(d['status'],'private');self.assertIn('emergency number',d['answer']);self.assertIn('saved privately',d['answer']);self.assertEqual(self.d.request('dashboard')[0],403);self.p.request('consent',{'enabled':True});self.assertTrue(any(m['status']=='pending' for m in self.d.request('dashboard')[1]['messages']))
 def test_no_public_doctor_registration(self):
  self.assertEqual(Client(self.base).request('register',{'role':'doctor','name':'Imposter','email':'fake@demo.medico','password':'PrivateDemo24!'})[0],403)
 def test_medical_profile_update(self):
  payload={'age':28,'blood':'O+','allergies':'Penicillin','conditions':'Hypertension, Type 2 diabetes'};self.assertEqual(self.p.request('profile',payload)[0],403);self.assertEqual(self.d.request('profile',payload)[0],200);self.assertEqual(self.p.request('dashboard')[1]['patient']['allergies'],['Penicillin'])
 def test_logout_invalidates_session(self):
  self.assertEqual(self.p.request('logout',{})[0],200);self.assertEqual(self.p.request('dashboard')[0],401)
if __name__=='__main__':unittest.main()
