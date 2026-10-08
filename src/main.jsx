import React, { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import {
  HeartPulse,
  LayoutDashboard,
  Files,
  Pill,
  MessageCircle,
  ShieldCheck,
  LogOut,
  ArrowUpRight,
  ArrowRight,
  Plus,
  Check,
  Clock,
  ChevronRight,
  Activity,
  CalendarDays,
  Lock,
  Search,
  Bell,
  Stethoscope,
  User,
  AlertTriangle,
  Fingerprint,
  X,
  Send,
  Download,
} from "lucide-react";
import "./style.css";
let session = null;
let selectedPatient = null;
const scopedRoutes = new Set([
  "dashboard",
  "audit",
  "consent",
  "profile",
  "medicine",
  "record",
  "emergency",
  "chat",
  "reply",
]);
function initials(name) {
  return name
    .replace(/^Dr\.\s*/, "")
    .split(/\s+/)
    .slice(0, 2)
    .map((n) => n[0])
    .join("")
    .toUpperCase();
}
async function api(path, body) {
  let r;
  try {
    r = await fetch(
      "/api/" +
        path +
        (selectedPatient && scopedRoutes.has(path)
          ? "?patient=" + encodeURIComponent(selectedPatient)
          : ""),
      {
        method: body ? "POST" : "GET",
        credentials: "same-origin",
        headers: body
          ? {
              "Content-Type": "application/json",
              "X-CSRF-Token": session?.csrf || "",
            }
          : {},
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(10000),
      },
    );
  } catch {
    throw Error("Unable to reach the care service. Please try again shortly.");
  }
  if (!r.headers.get("content-type")?.includes("application/json")) {
    throw Error("The care service is unavailable. Please try again shortly.");
  }
  const d = await r.json();
  if (!r.ok) {
    const error = Error(d.error || "Request failed");
    error.status = r.status;
    throw error;
  }
  return d;
}
const nav = [
  ["overview", "Overview", LayoutDashboard],
  ["history", "Medical history", Files],
  ["medications", "Medications", Pill],
  ["doctoc", "Doctoc assistant", MessageCircle],
  ["privacy", "Privacy & access", ShieldCheck],
];
function App() {
  const [user, setUser] = useState(null),
    [checkingSession, setCheckingSession] = useState(true),
    [data, setData] = useState(null),
    [patients, setPatients] = useState([]),
    [activePatient, setActivePatient] = useState("p1"),
    [page, setPage] = useState("overview"),
    [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [modal, setModal] = useState(null),
    [audit, setAudit] = useState([]),
    [query, setQuery] = useState(""),
    [busy, setBusy] = useState(false),
    [emergency, setEmergency] = useState(false);
  const doctor = user?.role === "doctor";
  async function refresh() {
    const requested = selectedPatient;
    try {
      const result = await api("dashboard");
      if (requested !== selectedPatient || !session) return;
      setData(result);
      setError("");
    } catch (e) {
      if (requested !== selectedPatient || !session) return;
      setData(null);
      setAudit([]);
      setModal(null);
      setEmergency(false);
      if (e.status === 401) {
        session = null;
        setUser(null);
        setAudit([]);
        setPage("overview");
      }
      setError(e.message);
    }
  }
  useEffect(() => {
    api("me")
      .then((d) => {
        session = d.user;
        selectedPatient = d.user.role === "doctor" ? "p1" : null;
        setUser(d.user);
      })
      .catch(() => {})
      .finally(() => setCheckingSession(false));
  }, []);
  useEffect(() => {
    if (user) refresh();
  }, [user, activePatient]);
  useEffect(() => {
    if (doctor)
      api("patients")
        .then((d) => setPatients(d.patients))
        .catch((e) => setError(e.message));
  }, [user]);
  useEffect(() => {
    if (!user) return;
    const interval = setInterval(() => {
      refresh();
      if (doctor)
        api("patients")
          .then((d) => setPatients(d.patients))
          .catch(() => {});
    }, 15000);
    return () => clearInterval(interval);
  }, [user, activePatient]);
  useEffect(() => {
    if (!user || page !== "privacy") return;
    let current = true;
    const requested = selectedPatient;
    api("audit")
      .then((d) => {
        if (current && requested === selectedPatient && session)
          setAudit(d.audit);
      })
      .catch((e) => {
        if (current && requested === selectedPatient) {
          setAudit([]);
          setError(e.message);
        }
      });
    return () => {
      current = false;
    };
  }, [page, user, data, activePatient]);
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(""), 4000);
      return () => clearTimeout(t);
    }
  }, [toast]);
  const [reminder, setReminder] = useState(null);
  const reminded = useRef(new Set());
  const timer = useRef(null);
  const audio = useRef(null);
  function showReminder(m) {
    setReminder(m);
    if (audio.current?.state === "running") {
      const ctx = audio.current;
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.frequency.value = 880;
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
      oscillator.start();
      oscillator.stop(ctx.currentTime + 0.6);
    }
    if ("Notification" in window && Notification.permission === "granted")
      new Notification("Digital Medico reminder", {
        body: `Time for ${m.name} — ${m.dose}`,
      });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      act(
        "medicine",
        { id: m.id, status: "missed" },
        "Unconfirmed dose marked missed",
      );
      setReminder(null);
    }, 300000);
  }
  function snooze(m) {
    clearTimeout(timer.current);
    setReminder(null);
    timer.current = setTimeout(() => showReminder(m), 300000);
  }
  useEffect(() => {
    if (!data || doctor) return;
    function check() {
      const now = new Date();
      const time = now.toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Asia/Kolkata",
      });
      for (const m of data.medicines) {
        const key =
          now.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" }) +
          ":" +
          m.id;
        if (
          m.timing === time &&
          m.status === "pending" &&
          !reminded.current.has(key)
        ) {
          reminded.current.add(key);
          showReminder(m);
          break;
        }
      }
    }
    check();
    const t = setInterval(check, 10000);
    return () => clearInterval(t);
  }, [data, doctor]);
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      audio.current?.close();
      audio.current = null;
    },
    [user],
  );
  async function act(path, body, msg) {
    if (path === "medicine" && ["taken", "missed"].includes(body?.status)) {
      clearTimeout(timer.current);
      setReminder(null);
    }
    setBusy(true);
    try {
      await api(path, body);
      await refresh();
      if (msg) setToast(msg);
      return true;
    } catch (e) {
      setToast(e.message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  if (checkingSession)
    return (
      <div className="session-loading" role="status">
        <Brand />
        <p>Checking your secure session…</p>
      </div>
    );
  if (!user)
    return (
      <Login
        onLogin={(u) => {
          session = u;
          selectedPatient = u.role === "doctor" ? "p1" : null;
          setActivePatient("p1");
          setPage("overview");
          setError("");
          setAudit([]);
          setData(null);
          setUser(u);
        }}
      />
    );
  const patient = data?.patient;
  const meds = data?.medicines || [];
  const taken = meds.filter((m) => m.status === "taken").length;
  const records = (data?.records || []).filter((r) =>
    (r.title + " " + r.detail).toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div className="app">
      <aside className="sidebar">
        <Brand />
        <div className="workspace">
          <span className="workspace-icon">
            {doctor ? <Stethoscope size={18} /> : <User size={18} />}
          </span>
          <div>
            <b>{doctor ? "Clinical workspace" : "Patient workspace"}</b>
            <small>{doctor ? "Doctor portal" : "Your personal care hub"}</small>
          </div>
          <span className="online" />
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav>
          {nav.map(([id, label, Icon]) => (
            <button
              key={id}
              className={page === id ? "active" : ""}
              onClick={() => {
                setPage(id);
                setQuery("");
              }}
            >
              <Icon size={19} />
              {doctor && id === "doctoc" ? "Patient questions" : label}
              {id === "doctoc" && (
                <span className="new">
                  {doctor
                    ? data?.messages.filter((m) => m.status === "pending")
                        .length || 0
                    : "NEW"}
                </span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="privacy-card">
            <ShieldCheck size={25} />
            <b>Your privacy. Our priority.</b>
            <p>Medical information is shared only with your consent.</p>
            <button onClick={() => setPage("privacy")}>
              Manage access <ArrowUpRight size={14} />
            </button>
          </div>
          <div className="profile">
            <div className="avatar">{initials(user.name)}</div>
            <div>
              <b>{user.name}</b>
              <small>
                {doctor
                  ? "Verified demo doctor"
                  : `Patient · ${data?.patient.id || "Personal account"}`}
              </small>
            </div>
            <button
              title="Sign out"
              onClick={async () => {
                await api("logout", {});
                session = null;
                selectedPatient = null;
                setPatients([]);
                setActivePatient("p1");
                setUser(null);
                setData(null);
                setPage("overview");
                setAudit([]);
                setReminder(null);
                setModal(null);
                setToast("");
                setError("");
              }}
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
      <div className="main">
        <header>
          <div className="breadcrumb">
            Workspace <ChevronRight size={14} />
            <b>{nav.find((n) => n[0] === page)?.[1]}</b>
          </div>
          <div className="header-right">
            <span className="secure">
              <Lock size={13} /> Private demo environment
            </span>
            <button
              title="View medication reminders"
              onClick={() => {
                setPage("medications");
                setToast("Reminders appear while this app is open.");
              }}
            >
              <Bell size={19} />
              <i />
            </button>
            <div className="avatar small">{initials(user.name)}</div>
          </div>
        </header>
        <main>
          {doctor && (
            <div className="patient-switcher">
              <div>
                <Stethoscope size={17} />
                <label>
                  Patient workspace
                  <select
                    aria-label="Select patient"
                    value={activePatient}
                    onChange={(e) => {
                      selectedPatient = e.target.value;
                      setActivePatient(e.target.value);
                      setAudit([]);
                      setData(null);
                      setError("");
                      setModal(null);
                      setEmergency(false);
                      setQuery("");
                    }}
                  >
                    {patients.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                        {p.consent ? "" : " · Consent required"}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <button
                className="outline"
                onClick={() => {
                  refresh();
                  api("patients").then((d) => setPatients(d.patients));
                }}
              >
                Refresh record
              </button>
            </div>
          )}
          <div className="page-title">
            <div>
              <div className="eyebrow">YOUR HEALTH, CONNECTED</div>
              <h1>
                {page === "overview"
                  ? doctor
                    ? "Care starts with context."
                    : "A little care, every day."
                  : page === "history"
                    ? "Your health story."
                    : page === "medications"
                      ? "Stay on track."
                      : page === "doctoc"
                        ? doctor
                          ? "A conversation that cares."
                          : "Meet your care companion."
                        : "You’re in control."}
              </h1>
              <p>
                {page === "overview"
                  ? doctor
                    ? "Welcome, Dr. Chen. Here’s your patient’s care at a glance."
                    : `Welcome back, ${user.name.split(" ")[0]}. Let’s make today a healthy one.`
                  : page === "history"
                    ? "Every visit, every detail — together in one place."
                    : page === "medications"
                      ? "Your doctor’s plan, one dose at a time. Schedule in IST."
                      : page === "doctoc"
                        ? "Stay connected with your care team."
                        : "Decide who can see your medical information."}
              </p>
            </div>
            <div className="date-chip">
              <CalendarDays size={16} />
              {new Date().toLocaleDateString("en-IN", {
                month: "short",
                day: "numeric",
                year: "numeric",
                timeZone: "Asia/Kolkata",
              })}
            </div>
          </div>
          {error && (
            <div className="notice error">
              <AlertTriangle size={18} />
              {error}
            </div>
          )}
          {data && page === "overview" && (
            <>
              <section className="hero">
                <div className="hero-copy">
                  <span className="hero-tag">
                    <span />{" "}
                    {doctor
                      ? "PATIENT CARE SUMMARY"
                      : "YOUR PERSONAL HEALTH SPACE"}
                  </span>
                  <h2>
                    {doctor
                      ? "The full picture.\nBetter decisions."
                      : "Better health starts\nwith being connected."}
                  </h2>
                  <p>
                    {doctor
                      ? "A unified record, medication adherence and patient questions. Everything you need for thoughtful care."
                      : "Your history, medications, and care team.\nAll together. Always in your control."}
                  </p>
                  <button
                    className="light-btn"
                    onClick={() => setPage("history")}
                  >
                    {doctor ? "View patient history" : "View my health record"}{" "}
                    <ArrowRight size={17} />
                  </button>
                </div>
                <div className="hero-art">
                  <div className="orbit o1" />
                  <div className="orbit o2" />
                  <div className="orbit o3" />
                  <div className="art-center">
                    <HeartPulse size={60} strokeWidth={1.4} />
                  </div>
                  <div className="float-pill fp1">
                    <ShieldCheck size={19} />
                    <div>
                      <b>Protected by consent</b>
                      <small>Only shared on your terms</small>
                    </div>
                  </div>
                  <div className="float-pill fp2">
                    <Activity size={19} />
                    <div>
                      <b>A healthier tomorrow</b>
                      <small>One step at a time</small>
                    </div>
                  </div>
                  <span className="spark s1">+</span>
                  <span className="spark s2">+</span>
                </div>
              </section>
              <div className="stats">
                <Stat
                  icon={Files}
                  color="green"
                  label="Medical records"
                  value={data.records.length}
                  foot="Your complete care timeline"
                />
                <Stat
                  icon={Pill}
                  color="orange"
                  label="Today’s medications"
                  value={`${taken} / ${meds.length}`}
                  foot="Doses marked as taken"
                />
                <Stat
                  icon={ShieldCheck}
                  color="blue"
                  label="Record access"
                  value={data.consent ? "Protected" : "Revoked"}
                  foot={
                    data.consent
                      ? "Patient consent is enabled"
                      : "Doctor access is revoked"
                  }
                />
              </div>
              <div className="dashboard-grid">
                <section className="panel">
                  <PanelTitle
                    title="Today’s medications"
                    subtitle="Small steps. Consistent care."
                    action="View all"
                    onClick={() => setPage("medications")}
                  />
                  {meds.slice(0, 3).map((m) => (
                    <Medicine
                      key={m.id}
                      m={m}
                      doctor={doctor}
                      onAction={(status) =>
                        act("medicine", { id: m.id, status }, "Dose updated")
                      }
                    />
                  ))}
                  <div className="panel-foot">
                    <Clock size={14} /> Timings follow your doctor’s
                    prescription
                  </div>
                </section>
                <section className="panel">
                  <PanelTitle
                    title="Recent activity"
                    subtitle="Your care journey, up to date."
                    action="View history"
                    onClick={() => setPage("history")}
                  />
                  <div className="timeline">
                    {data.records.slice(0, 2).map((r) => (
                      <div className="timeline-item" key={r.id}>
                        <div className="timeline-dot">
                          <Files size={16} />
                        </div>
                        <div>
                          <small>{formatDate(r.date)}</small>
                          <h4>{r.title}</h4>
                          <p>{r.doctor}</p>
                          <span className="tag">Consultation</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              </div>
              <div className="bottom-grid">
                <section className="assistant-banner">
                  <div className="bot-icon">
                    <MessageCircle size={27} />
                    <span>✦</span>
                  </div>
                  <div>
                    <span className="eyebrow">DOCTOC ASSISTANT</span>
                    <h3>A question on your mind?</h3>
                    <p>Get guidance or connect with your doctor.</p>
                  </div>
                  <button onClick={() => setPage("doctoc")}>
                    Let’s talk <ArrowUpRight size={17} />
                  </button>
                </section>
                <section className="emergency-banner">
                  <div className="icon-box red">
                    <HeartPulse size={23} />
                  </div>
                  <div>
                    <h3>Ready when it matters</h3>
                    <p>
                      {doctor
                        ? "Secure emergency history access."
                        : "Your emergency profile is in one place."}
                    </p>
                    <button
                      onClick={() =>
                        doctor ? setModal("emergency") : setPage("history")
                      }
                    >
                      {doctor ? "Emergency access" : "View emergency profile"}{" "}
                      <ArrowRight size={14} />
                    </button>
                  </div>
                </section>
              </div>
            </>
          )}
          {data && page === "history" && (
            <>
              <div className="history-top">
                <section className="panel patient-card">
                  <div className="avatar large">{initials(patient.name)}</div>
                  <div>
                    <h3>{patient.name}</h3>
                    <p>
                      {patient.age
                        ? `${patient.age} years`
                        : "Age not recorded"}{" "}
                      · {patient.id}
                    </p>
                  </div>
                  <span className="tag">Demo patient</span>
                </section>
                <button
                  className="primary"
                  onClick={() =>
                    doctor
                      ? setModal("record")
                      : setToast(
                          "Your care team updates clinical records after every visit.",
                        )
                  }
                >
                  <Plus size={17} />
                  {doctor ? "Add clinical record" : "How records are updated"}
                </button>
              </div>
              {doctor && (
                <button
                  className="profile-edit"
                  onClick={() => setModal("profile")}
                >
                  Update emergency profile <ArrowUpRight size={14} />
                </button>
              )}
              <div className="medical-profile">
                <div>
                  <small>BLOOD GROUP</small>
                  <b>{patient.blood}</b>
                </div>
                <div className="allergy">
                  <small>KNOWN ALLERGIES</small>
                  <b>
                    <AlertTriangle size={17} />{" "}
                    {patient.allergies.join(" · ") || "Not recorded"}
                  </b>
                </div>
                <div>
                  <small>ONGOING CONDITIONS</small>
                  <b>{patient.conditions.join(" · ") || "Not recorded"}</b>
                </div>
                <div>
                  <small>EMERGENCY ID</small>
                  <b>{patient.id}</b>
                </div>
              </div>
              <div className="section-head">
                <h3>
                  Medical timeline{" "}
                  <span className="count">{data.records.length}</span>
                </h3>
                <label className="search">
                  <Search size={16} />
                  <input
                    placeholder="Search records…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </label>
              </div>
              {records.map((r) => (
                <section className="record panel" key={r.id}>
                  <div className="record-date">
                    <b>{new Date(r.date + "T00:00:00").getDate()}</b>
                    <small>
                      {new Date(r.date + "T00:00:00").toLocaleDateString("en", {
                        month: "short",
                        year: "numeric",
                      })}
                    </small>
                  </div>
                  <div>
                    <span className="tag">Consultation</span>
                    <h3>{r.title}</h3>
                    <p>{r.detail}</p>
                    <small>
                      <Stethoscope size={14} /> {r.doctor}
                    </small>
                  </div>
                  <ShieldCheck className="record-shield" size={20} />
                </section>
              ))}
              {!records.length && (
                <div className="empty">
                  {query
                    ? "No matching records."
                    : "No visits recorded yet. Your doctor can add your first clinical record."}
                </div>
              )}
            </>
          )}
          {data && page === "medications" && (
            <>
              <div className="med-summary">
                <div>
                  <span className="eyebrow">TODAY’S PROGRESS</span>
                  <h2>
                    {taken} of {meds.length} doses taken{" "}
                    <span>Keep a steady rhythm.</span>
                  </h2>
                  <div className="progress">
                    <div
                      style={{
                        width: `${meds.length ? (taken / meds.length) * 100 : 0}%`,
                      }}
                    />
                  </div>
                </div>
                {doctor ? (
                  <button
                    className="primary"
                    onClick={() => setModal("medicine")}
                  >
                    <Plus size={17} />
                    New prescription
                  </button>
                ) : (
                  <button
                    className="outline"
                    onClick={async () => {
                      try {
                        const Audio =
                          window.AudioContext || window.webkitAudioContext;
                        if (Audio) {
                          audio.current ??= new Audio();
                          await audio.current.resume();
                        }
                      } catch {}
                      if ("Notification" in window) {
                        const p = await Notification.requestPermission();
                        setToast(
                          p === "granted"
                            ? "Sound and notifications enabled while this app is open."
                            : "Use in-app reminders while the app is open.",
                        );
                      } else
                        setToast(
                          "This browser supports in-app reminders only.",
                        );
                    }}
                  >
                    <Bell size={16} />
                    Enable reminders
                  </button>
                )}
              </div>
              <section className="panel">
                <PanelTitle
                  title={
                    doctor
                      ? "Prescribed medications"
                      : "Your medication schedule"
                  }
                  subtitle="Take medication only as directed by your doctor."
                />
                {meds.map((m) => (
                  <Medicine
                    key={m.id}
                    m={m}
                    doctor={doctor}
                    full
                    onAction={(status) => {
                      if (status === "snoozed") snooze(m);
                      else clearTimeout(timer.current);
                      act(
                        "medicine",
                        { id: m.id, status },
                        status === "snoozed"
                          ? "Snoozed — in-app reminder in 5 minutes"
                          : "Dose status saved",
                      );
                    }}
                  />
                ))}
                <div className="panel-foot">
                  <ShieldCheck size={15} />
                  Your care team can see logged doses. An unanswered in-app
                  reminder is marked missed after 5 minutes.
                </div>
              </section>
              {data.doseLogs.length > 0 && (
                <section className="panel adherence">
                  <PanelTitle
                    title="Dose activity"
                    subtitle="A history of recorded dose decisions."
                  />
                  {data.doseLogs.map((log, i) => (
                    <div key={i} className="audit-row">
                      <div className="icon-box orange">
                        <Pill size={17} />
                      </div>
                      <div>
                        <b>{log.name}</b>
                        <small>
                          {log.day} · recorded {log.time} UTC
                        </small>
                      </div>
                      <span className={"dose-status " + log.status}>
                        {log.status}
                      </span>
                    </div>
                  ))}
                </section>
              )}
              <div className="notice">
                <Clock size={18} />
                Prototype reminders require the app to remain open. For reliable
                medication alarms, use your phone’s alarm as well.
              </div>
            </>
          )}
          {data && page === "doctoc" && (
            <Chat
              patientName={patient.name}
              doctor={doctor}
              messages={data.messages}
              act={act}
              busy={busy}
            />
          )}
          {page === "privacy" && (
            <>
              <div className="privacy-hero">
                <div className="icon-box green">
                  <ShieldCheck size={30} />
                </div>
                <div>
                  <h2>Care with consent.</h2>
                  <p>
                    Your medical history belongs to you. Access is explicit,
                    limited, and recorded.
                  </p>
                </div>
                <span className="tag">Privacy first</span>
              </div>
              <div className="dashboard-grid">
                <section className="panel settings">
                  <h3>Care team access</h3>
                  <p>
                    Allow the demo doctor to view your history, prescriptions
                    and questions. Enabling access also shares any saved private
                    questions.
                  </p>
                  <div className="access-row">
                    <div className="avatar">SC</div>
                    <div>
                      <b>Dr. Sarah Chen</b>
                      <small>Demo clinician · patient care</small>
                    </div>
                    {doctor ? (
                      <span className="tag">Patient-controlled</span>
                    ) : (
                      <button
                        aria-label="Toggle doctor access"
                        className={"toggle " + (data?.consent ? "on" : "")}
                        onClick={() =>
                          act(
                            "consent",
                            { enabled: !data?.consent },
                            data?.consent
                              ? "Doctor access revoked"
                              : "Doctor access granted",
                          )
                        }
                      >
                        <span />
                      </button>
                    )}
                  </div>
                  <div className="notice">
                    <Lock size={16} />
                    Revoking consent also blocks emergency access in this
                    prototype.
                  </div>
                </section>
                <section className="panel settings">
                  <h3>Built for a private demo</h3>
                  <ul className="privacy-list">
                    <li>
                      <Check />
                      Role-based access checked on the server
                    </li>
                    <li>
                      <Check />
                      Password hashing & HTTP-only sessions
                    </li>
                    <li>
                      <Check />
                      No third-party AI receives your records
                    </li>
                    <li>
                      <Check />
                      Every record access leaves an audit trail
                    </li>
                  </ul>
                  <p className="muted">
                    Synthetic data only. Local database is not encrypted at
                    rest. This prototype is not ready for real patient data.
                  </p>
                </section>
              </div>
              <section className="panel audit">
                <PanelTitle
                  title="Access activity"
                  subtitle="A transparent trail of who accessed your information."
                />
                {audit.length ? (
                  audit.map((a, i) => (
                    <div className="audit-row" key={i}>
                      <div className="icon-box green">
                        <ShieldCheck size={17} />
                      </div>
                      <div>
                        <b>{a.action}</b>
                        <small>{a.actor}</small>
                      </div>
                      <time>{a.time} UTC</time>
                    </div>
                  ))
                ) : (
                  <div className="empty">No access events yet.</div>
                )}
              </section>
            </>
          )}
          <footer>
            <span>
              <HeartPulse size={14} /> Digital Medico <i>·</i> Care, connected.
            </span>
            <span>
              <ShieldCheck size={13} /> Synthetic demo data only
            </span>
          </footer>
        </main>
      </div>
      {toast && (
        <div role="status" className="toast">
          <Check size={17} />
          {toast}
        </div>
      )}
      {reminder && (
        <div className="reminder">
          <Bell />
          <h3>Time for {reminder.name}</h3>
          <p>{reminder.dose}</p>
          <button
            className="primary"
            onClick={() => {
              clearTimeout(timer.current);
              act(
                "medicine",
                { id: reminder.id, status: "taken" },
                "Dose logged",
              );
              setReminder(null);
            }}
          >
            Mark taken
          </button>
          <button
            className="outline"
            onClick={() => {
              act("medicine", { id: reminder.id, status: "snoozed" });
              snooze(reminder);
            }}
          >
            Snooze 5 min
          </button>
        </div>
      )}
      {modal && (
        <Modal
          title={
            modal === "record"
              ? "Add a clinical record"
              : modal === "medicine"
                ? "New prescription"
                : modal === "profile"
                  ? "Update emergency profile"
                  : "Emergency record access"
          }
          close={() => {
            setModal(null);
            setEmergency(false);
          }}
        >
          {modal === "emergency" ? (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const f = new FormData(e.target);
                if (
                  await act(
                    "emergency",
                    {
                      patientId: f.get("patientId"),
                      reason: f.get("reason"),
                      verified: emergency,
                    },
                    "Emergency access recorded",
                  )
                ) {
                  setModal(null);
                  setPage("history");
                  setEmergency(false);
                }
              }}
            >
              <div className="notice error">
                <AlertTriangle size={18} />
                Demo identity check only. No biometric data is captured. Patient
                consent must be enabled.
              </div>
              <Field
                label="Patient ID"
                name="patientId"
                placeholder={patient?.id}
                defaultValue={patient?.id}
              />
              <Field
                label="Reason for access"
                name="reason"
                placeholder="Describe the emergency"
              />
              <button
                type="button"
                className={"biometric " + (emergency ? "verified" : "")}
                onClick={() => setEmergency(true)}
              >
                <Fingerprint size={30} />
                {emergency
                  ? "Demo identity check confirmed"
                  : "Simulate biometric verification"}
              </button>
              <button className="primary" disabled={!emergency || busy}>
                Access emergency profile <ArrowRight size={16} />
              </button>
            </form>
          ) : (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const f = Object.fromEntries(new FormData(e.target));
                if (
                  await act(
                    modal,
                    f,
                    modal === "record"
                      ? "Clinical record saved"
                      : modal === "profile"
                        ? "Emergency profile updated"
                        : "Prescription added",
                  )
                )
                  setModal(null);
              }}
            >
              {modal === "profile" ? (
                <>
                  <Field
                    label="Age"
                    name="age"
                    type="number"
                    min="1"
                    max="120"
                    defaultValue={patient.age || ""}
                  />
                  <label>
                    Blood group
                    <select
                      aria-label="Blood group"
                      name="blood"
                      defaultValue={patient.blood}
                    >
                      {[
                        "Not recorded",
                        "A+",
                        "A-",
                        "B+",
                        "B-",
                        "AB+",
                        "AB-",
                        "O+",
                        "O-",
                      ].map((b) => (
                        <option key={b}>{b}</option>
                      ))}
                    </select>
                  </label>
                  <Field
                    label="Allergies (comma-separated)"
                    name="allergies"
                    required={false}
                    defaultValue={patient.allergies.join(", ")}
                  />
                  <Field
                    label="Conditions (comma-separated)"
                    name="conditions"
                    required={false}
                    defaultValue={patient.conditions.join(", ")}
                  />
                  <div className="notice">
                    <ShieldCheck size={16} />
                    Only enter clinically reviewed information. Empty fields
                    mean not recorded.
                  </div>
                </>
              ) : modal === "record" ? (
                <>
                  <Field
                    label="Visit / diagnosis"
                    name="title"
                    placeholder="e.g. Routine follow-up"
                  />
                  <label>
                    Clinical notes
                    <textarea
                      name="detail"
                      required
                      placeholder="Diagnosis, findings and follow-up plan"
                      maxLength={2000}
                    />
                  </label>
                </>
              ) : (
                <>
                  <Field
                    label="Medication name"
                    name="name"
                    placeholder="e.g. Amlodipine"
                  />
                  <Field
                    label="Dose and instructions"
                    name="dose"
                    placeholder="e.g. 5 mg · 1 tablet with food"
                  />
                  <Field label="Daily dose time" name="timing" type="time" />
                </>
              )}
              <button className="primary" disabled={busy}>
                Save{" "}
                {modal === "record"
                  ? "record"
                  : modal === "profile"
                    ? "profile"
                    : "prescription"}{" "}
                <Check size={16} />
              </button>
            </form>
          )}
        </Modal>
      )}
    </div>
  );
}
function Brand() {
  return (
    <div className="brand">
      <span>
        <HeartPulse size={25} />
      </span>
      <div>
        digital<span>medico</span>
        <small>CARE, CONNECTED.</small>
      </div>
    </div>
  );
}
function Field({ label, ...props }) {
  return (
    <label>
      {label}
      <input required maxLength={120} {...props} />
    </label>
  );
}
function Login({ onLogin }) {
  const [role, setRole] = useState("patient"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [signup, setSignup] = useState(false);
  return (
    <div className="login">
      <div className="login-story">
        <Brand />
        <div>
          <div className="eyebrow">A BETTER WAY TO CARE</div>
          <h1>
            Your health story.
            <br />
            Always connected.
          </h1>
          <p>
            One secure place for your medical history,
            <br />
            your medications, and your care team.
          </p>
          <div className="login-illustration">
            <div className="orbit o1" />
            <div className="orbit o2" />
            <HeartPulse size={110} strokeWidth={1} />
            <span className="login-float">
              <ShieldCheck />
              Private by design
            </span>
          </div>
          <div className="login-features">
            <span>
              <Files />
              Unified medical history
            </span>
            <span>
              <Pill />
              Thoughtful reminders
            </span>
            <span>
              <MessageCircle />
              Connected care
            </span>
          </div>
        </div>
        <small>Built for people. Designed around privacy.</small>
      </div>
      <div className="login-form">
        <span className="tag">24-HOUR HACKATHON PROTOTYPE</span>
        <h2>Welcome to better care.</h2>
        <p>Choose your workspace to get started.</p>
        <div className="role-picker">
          {["patient", "doctor"].map((r) => (
            <button
              key={r}
              disabled={busy}
              aria-pressed={role === r}
              onClick={() => {
                setRole(r);
                setSignup(false);
                setError("");
              }}
              className={role === r ? "selected" : ""}
            >
              {r === "patient" ? <User /> : <Stethoscope />}
              {r === "patient" ? "I’m a patient" : "I’m a doctor"}
              <small>
                {r === "patient"
                  ? "My health, my control"
                  : "Care with full context"}
              </small>
            </button>
          ))}
        </div>
        <form
          key={role + String(signup)}
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              const f = Object.fromEntries(new FormData(e.target));
              const d = await api(signup ? "register" : "login", {
                ...f,
                role,
                ...(signup ? { consent: f.consent === "on" } : {}),
              });
              onLogin(d.user);
            } catch (e) {
              setError(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {signup && (
            <Field
              label="Demo patient name"
              name="name"
              placeholder="e.g. Jamie Parker"
            />
          )}
          <Field
            label="Email address"
            name="email"
            autoComplete="username"
            type="email"
            defaultValue={
              signup
                ? ""
                : role === "patient"
                  ? "alex@demo.medico"
                  : "sarah@demo.medico"
            }
          />
          <Field
            label="Password"
            name="password"
            autoComplete={signup ? "new-password" : "current-password"}
            type="password"
            defaultValue={signup ? "" : "MedicoDemo24!"}
            minLength={signup ? 8 : undefined}
          />
          {signup && (
            <label className="consent-checkbox">
              <input type="checkbox" name="consent" />
              Allow demo Dr. Sarah Chen to access this fictional account. You
              can revoke access anytime.
            </label>
          )}
          {error && (
            <div role="alert" className="notice error">
              {error}
            </div>
          )}
          <button className="primary" disabled={busy}>
            {busy
              ? "Signing in…"
              : signup
                ? "Create patient account"
                : `Enter ${role} workspace`}
            <ArrowRight size={18} />
          </button>
        </form>
        {role === "patient" && (
          <button
            disabled={busy}
            className="signup-link"
            onClick={() => {
              setSignup(!signup);
              setError("");
            }}
          >
            {signup
              ? "Already have an account? Sign in"
              : "New here? Create a demo patient account"}{" "}
            <ArrowRight size={14} />
          </button>
        )}
        <div className="demo-note">
          <ShieldCheck size={19} />
          <div>
            <b>A safe space to explore</b>
            <p>
              Demo credentials are prefilled. Use only fictional demo data.
              Please don’t enter real patient information.
            </p>
          </div>
        </div>
        <small className="login-bottom">
          No real biometric capture · No external AI sharing
        </small>
      </div>
    </div>
  );
}
function Stat({ icon: Icon, color, label, value, foot }) {
  return (
    <section className="stat panel">
      <div>
        <span>{label}</span>
        <div className={"icon-box " + color}>
          <Icon size={20} />
        </div>
      </div>
      <h2>{value}</h2>
      <small>{foot}</small>
    </section>
  );
}
function PanelTitle({ title, subtitle, action, onClick }) {
  return (
    <div className="panel-title">
      <div>
        <h3>{title}</h3>
        <p>{subtitle}</p>
      </div>
      {action && (
        <button onClick={onClick}>
          {action}
          <ChevronRight size={14} />
        </button>
      )}
    </div>
  );
}
function Medicine({ m, doctor, onAction, full }) {
  return (
    <div className={"medicine " + (full ? "full" : "")}>
      <div className="icon-box orange">
        <Pill size={19} />
      </div>
      <div className="medicine-info">
        <b>{m.name}</b>
        <small>{m.dose}</small>
      </div>
      <span className="med-time">
        <Clock size={13} />
        {m.timing}
      </span>
      {m.status === "taken" ? (
        <span className="dose-status taken">
          <Check size={13} />
          Taken
        </span>
      ) : doctor ? (
        <span className={"dose-status " + m.status}>
          {m.status === "pending" ? "Upcoming" : m.status}
        </span>
      ) : (
        <div className="dose-actions">
          {m.status !== "pending" && (
            <span className={"dose-status " + m.status}>{m.status}</span>
          )}
          <button className="take" onClick={() => onAction("taken")}>
            <Check size={14} />
            {full ? "Mark taken" : "Take"}
          </button>
          {full && (
            <>
              <button title="Snooze dose" onClick={() => onAction("snoozed")}>
                Snooze
              </button>
              <button onClick={() => onAction("missed")}>Missed</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
function Chat({ doctor, messages, act, busy, patientName }) {
  const [q, setQ] = useState(""),
    [replies, setReplies] = useState({});
  return (
    <div className="chat-layout">
      <section className="panel chat">
        <div className="chat-top">
          <div className="bot-icon">
            <MessageCircle size={23} />
          </div>
          <div>
            <h3>{doctor ? "Patient inbox" : "Doctoc"}</h3>
            <small>
              {doctor
                ? "Review and respond to patient questions"
                : "Demo assistant · clinician escalation"}
            </small>
          </div>
          <span className="tag">{doctor ? "CARE TEAM" : "GUIDED SUPPORT"}</span>
        </div>
        <div className="chat-messages">
          {!messages.length && (
            <div className="chat-welcome">
              <div className="icon-box green">
                <MessageCircle size={30} />
              </div>
              <h2>
                {doctor
                  ? "Your inbox is clear."
                  : `Hi ${patientName.split(" ")[0]}, how can I help?`}
              </h2>
              <p>
                {doctor
                  ? "Questions sent from the patient portal will appear here."
                  : "Ask about your schedule or send a question to your doctor."}
              </p>
              {!doctor && (
                <div className="suggestions">
                  {[
                    "What is my medication schedule?",
                    "I have a question for my doctor",
                  ].map((t) => (
                    <button key={t} onClick={() => setQ(t)}>
                      {t}
                      <ArrowUpRight size={14} />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {[...messages].reverse().map((m) => (
            <div key={m.id} className="conversation">
              <div className="bubble patient">
                <small>{patientName}</small>
                {m.question}
              </div>
              <div className="bubble assistant">
                <small>
                  {m.status === "reviewed"
                    ? "Dr. Sarah Chen"
                    : "Doctoc · demo guidance"}
                </small>
                {m.answer}
                <span
                  className={"tag " + (m.status === "pending" ? "orange" : "")}
                >
                  {m.status === "private"
                    ? "Private · consent required"
                    : m.status === "pending"
                      ? "Sent to doctor"
                      : m.status === "reviewed"
                        ? "Doctor reviewed"
                        : "Schedule guidance"}
                </span>
              </div>
              {doctor && m.status === "pending" && (
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    await act(
                      "reply",
                      { id: m.id, answer: replies[m.id] },
                      "Reply sent to patient",
                    );
                    setReplies({ ...replies, [m.id]: "" });
                  }}
                  className="reply-form"
                >
                  <input
                    aria-label="Doctor reply"
                    required
                    placeholder="Write your response…"
                    value={replies[m.id] || ""}
                    onChange={(e) =>
                      setReplies({ ...replies, [m.id]: e.target.value })
                    }
                  />
                  <button className="primary" disabled={busy}>
                    <Send size={16} />
                  </button>
                </form>
              )}
            </div>
          ))}
        </div>
        {!doctor && (
          <form
            className="chat-input"
            onSubmit={async (e) => {
              e.preventDefault();
              if (await act("chat", { question: q })) setQ("");
            }}
          >
            <input
              aria-label="Your message"
              placeholder="Ask a question or describe how you’re feeling…"
              value={q}
              maxLength={2000}
              onChange={(e) => setQ(e.target.value)}
            />
            <button disabled={!q.trim() || busy} className="primary">
              <Send size={18} />
            </button>
          </form>
        )}
        <div className="chat-disclaimer">
          <Lock size={12} />
          No messages are sent to an external AI service.
        </div>
      </section>
      <aside className="chat-aside">
        <section className="panel settings">
          <ShieldCheck className="green-text" size={28} />
          <h3>
            Thoughtful guidance.
            <br />
            Human care.
          </h3>
          <p>
            Doctoc provides limited, scripted guidance. Clinical questions are
            sent to your doctor.
          </p>
          <hr />
          <b>Know when to get help</b>
          <p>
            For severe symptoms, chest pain or difficulty breathing, call your
            local emergency number. Don’t wait for a reply.
          </p>
        </section>
        <div className="notice">
          This demo does not diagnose conditions, change prescriptions, or
          replace a clinician.
        </div>
      </aside>
    </div>
  );
}
function Modal({ title, close, children }) {
  return (
    <div className="modal-backdrop" onClick={close}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="section-head">
          <h2>{title}</h2>
          <button aria-label="Close dialog" onClick={close}>
            <X size={21} />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}
function formatDate(d) {
  return new Date(d + "T00:00:00").toLocaleDateString("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}
createRoot(document.getElementById("root")).render(<App />);
