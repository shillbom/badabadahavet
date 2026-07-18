import { Link } from "react-router";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { consentRelevant, useConsent } from "@/lib/consent";
import BackButton from "@/components/ui/BackButton";

// External services, split by whether the browser talks to them directly
// (so they see the user's IP) or we fetch them server-side. Names/domains
// aren't translated; each description lives in i18n (privacy.third.*).
const DIRECT_SERVICES = [
  {
    key: "privacy.third.maps",
    label: "openstreetmap.org",
    href: "https://www.openstreetmap.org/copyright",
  },
  {
    key: "privacy.third.bdc",
    label: "bigdatacloud.com",
    href: "https://www.bigdatacloud.com/",
  },
  {
    key: "privacy.third.perspective",
    label: "perspectiveapi.com",
    href: "https://perspectiveapi.com/",
  },
  {
    key: "privacy.third.analytics",
    label: "policies.google.com",
    href: "https://policies.google.com/privacy",
  },
] as const;

const DATA_SOURCES = [
  {
    key: "privacy.third.hav",
    label: "badplatsen.havochvatten.se",
    href: "https://badplatsen.havochvatten.se/",
  },
  {
    key: "privacy.third.eea",
    label: "eea.europa.eu",
    href: "https://www.eea.europa.eu/themes/water/europes-seas-and-coasts/assessments/state-of-bathing-water",
  },
  {
    key: "privacy.third.smhi",
    label: "smhi.se",
    href: "https://www.smhi.se/data/oceanografi/havstemperatur",
  },
  {
    key: "privacy.third.meteo",
    label: "open-meteo.com",
    href: "https://open-meteo.com/",
  },
] as const;

// Public contact for privacy / data-subject requests.
const CONTACT_EMAIL = "simon.hillbom@gmail.com";
// Swedish data-protection authority, for the right to lodge a complaint.
const IMY_URL = "https://www.imy.se/";

export default function PrivacyPage() {
  const t = useT();

  return (
    <div className="px-4 pt-2">
      <div className="mb-4 flex items-center gap-2">
        <BackButton />
        <h2 className="font-display text-2xl font-black text-wave-900">
          {t("privacy.title")}
        </h2>
      </div>

      <p className="text-sm leading-relaxed text-slate-600">
        {t("privacy.intro")}
      </p>
      <p className="mt-2 text-xs text-slate-500">{t("privacy.updated")}</p>

      <Section title={t("privacy.collect.title")}>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>{t("privacy.collect.account")}</li>
          <li>{t("privacy.collect.content")}</li>
          <li>{t("privacy.collect.technical")}</li>
        </ul>
      </Section>

      <Section title={t("privacy.use.title")}>
        <p>{t("privacy.use.body")}</p>
      </Section>

      <Section title={t("privacy.basis.title")}>
        <p>{t("privacy.basis.body")}</p>
      </Section>

      <Section title={t("privacy.public.title")}>
        <p>{t("privacy.public.body")}</p>
      </Section>

      <Section title={t("privacy.storage.title")}>
        <p>{t("privacy.storage.body")}</p>
        <p className="mt-2">
          {t("privacy.storage.firebase")}{" "}
          <a
            href="https://firebase.google.com/support/privacy"
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-wave-700 underline hover:text-wave-800"
          >
            firebase.google.com/support/privacy
          </a>
          .
        </p>
      </Section>

      <Section title={t("privacy.retention.title")}>
        <p>{t("privacy.retention.body")}</p>
      </Section>

      <Section title={t("privacy.cookies.title")}>
        <p>{t("privacy.cookies.body")}</p>
        {consentRelevant ? (
          <label className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-wave-50/70 px-3 py-2 ring-1 ring-wave-100">
            <span className="text-[13px] font-medium text-slate-700">
              {t("consent.toggle.label")}
            </span>
            <AnalyticsToggle />
          </label>
        ) : null}
      </Section>

      <Section title={t("privacy.third.title")}>
        <p>{t("privacy.third.body")}</p>
        <p className="mt-3 font-semibold text-slate-600">
          {t("privacy.third.direct")}
        </p>
        <ServiceList items={DIRECT_SERVICES} t={t} />
        <p className="mt-3 font-semibold text-slate-600">
          {t("privacy.third.sources")}
        </p>
        <ServiceList items={DATA_SOURCES} t={t} />
      </Section>

      <Section title={t("privacy.rights.title")}>
        <p>{t("privacy.rights.body")}</p>
        <p className="mt-2">
          {t("privacy.rights.complaint")}{" "}
          <a
            href={IMY_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-wave-700 underline hover:text-wave-800"
          >
            imy.se
          </a>
          .
        </p>
      </Section>

      <Section title={t("privacy.safety.title")}>
        <p>{t("privacy.safety.body")}</p>
      </Section>

      <Section title={t("privacy.contact.title")}>
        <p>{t("privacy.controller")}</p>
        <p className="mt-2">
          {t("privacy.contact.body")}{" "}
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className="font-semibold text-wave-700 underline hover:text-wave-800"
          >
            {CONTACT_EMAIL}
          </a>
          .
        </p>
      </Section>

      <div className="mt-8 text-center text-xs text-slate-500">
        <Link to="/about" className="hover:underline">
          ← {t("privacy.back")}
        </Link>
      </div>
    </div>
  );
}

// A plain on/off switch bound to the analytics consent choice, so the user can
// grant or withdraw it any time (an undecided choice reads as off).
function AnalyticsToggle() {
  const t = useT();
  const choice = useConsent((s) => s.analytics);
  const setAnalytics = useConsent((s) => s.setAnalytics);
  const on = choice === "granted";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={t("consent.toggle.label")}
      onClick={() => setAnalytics(!on)}
      className={cn(
        "relative inline-flex h-6 w-11 flex-none items-center rounded-full transition-colors",
        "focus-visible:ring-2 focus-visible:ring-wave-500 focus-visible:ring-offset-2 focus-visible:outline-none",
        on ? "bg-wave-600" : "bg-slate-300",
      )}
    >
      <span
        className={cn(
          "inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform",
          on ? "translate-x-5" : "translate-x-0.5",
        )}
      />
    </button>
  );
}

function ServiceList({
  items,
  t,
}: {
  items: readonly { key: string; label: string; href: string }[];
  t: (key: string) => string;
}) {
  return (
    <ul className="mt-1 list-disc space-y-1.5 pl-5">
      {items.map((p) => (
        <li key={p.key}>
          {t(p.key)}
          {" — "}
          <a
            href={p.href}
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-wave-700 underline hover:text-wave-800"
          >
            {p.label}
          </a>
        </li>
      ))}
    </ul>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-6">
      <h3 className="mb-2 text-xs font-semibold tracking-wide text-wave-700 uppercase">
        {title}
      </h3>
      <div className="rounded-2xl bg-white/70 p-3 text-sm leading-relaxed text-slate-700 ring-1 ring-white/60">
        {children}
      </div>
    </section>
  );
}
