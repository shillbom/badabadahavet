import { Link } from "react-router";
import { motion } from "framer-motion";
import { useT } from "@/lib/i18n";
import BackButton from "@/components/ui/BackButton";

// Pre-filled Swish payment link (amount + message are editable by the payer).
const SWISH_URL =
  "https://app.swish.nu/1/p/sw/?sw=0734323512&amt=20.00&cur=SEK&msg=Badligan%20rulez&edit=amt,msg&src=qr";

export default function AboutPage() {
  const t = useT();

  return (
    <div className="px-4 pt-2 pb-12">
      <div className="mb-4 flex items-center gap-2">
        <BackButton />
        <h2 className="font-display text-2xl font-black text-wave-900">
          {t("about.title")}
        </h2>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 220, damping: 22 }}
        className="flex flex-col items-center gap-2"
      >
        <img
          src="/web-app-manifest-192x192.png"
          alt="Badligan"
          width="64"
          height="64"
          className="h-16 w-16 rounded-2xl shadow-md"
        />
        <h3 className="font-display text-xl font-black text-wave-900">
          {t("app.name")}
        </h3>
        <p className="text-center text-sm text-slate-600">
          {t("about.tagline")}
        </p>
      </motion.div>

      <Section title={t("about.what.title")}>
        <p>{t("about.what.body")}</p>
      </Section>

      <Section title={t("about.scoring.title")}>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>{t("about.scoring.swim")}</li>
          <li>{t("about.scoring.new_place")}</li>
          <li>{t("about.scoring.winter")}</li>
          <li>{t("about.scoring.achievements")}</li>
        </ul>
      </Section>

      <Section title={t("about.data.title")}>
        <p>
          {t("about.data.body")}{" "}
          <a
            href="https://badplatsen.havochvatten.se/"
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-wave-700 underline hover:text-wave-800"
          >
            badplatsen.havochvatten.se
          </a>
          .
        </p>
        <p className="mt-2">
          {t("about.data.eea")}{" "}
          <a
            href="https://www.eea.europa.eu/themes/water/europes-seas-and-coasts/assessments/state-of-bathing-water"
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-wave-700 underline hover:text-wave-800"
          >
            eea.europa.eu
          </a>
          .
        </p>
        <p className="mt-2">
          {t("about.data.smhi")}{" "}
          <a
            href="https://www.smhi.se/data/oceanografi/havstemperatur"
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-wave-700 underline hover:text-wave-800"
          >
            smhi.se
          </a>
          .
        </p>
        <p className="mt-2">
          {t("about.data.meteo")}{" "}
          <a
            href="https://open-meteo.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-wave-700 underline hover:text-wave-800"
          >
            open-meteo.com
          </a>
          .
        </p>
        <p className="mt-2">{t("about.data.maps")}</p>
        <p className="mt-1 text-xs text-slate-500">
          <a
            href="https://www.openstreetmap.org/copyright"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-wave-700"
          >
            © OpenStreetMap
          </a>
          {" · "}
          <a
            href="https://carto.com/attributions"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-wave-700"
          >
            CARTO
          </a>
          {" · "}
          <a
            href="https://www.esri.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-wave-700"
          >
            Esri
          </a>
          {" · "}
          <a
            href="https://www.bigdatacloud.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-wave-700"
          >
            BigDataCloud
          </a>
        </p>
      </Section>

      <Section title={t("about.privacy.title")}>
        <p>{t("about.privacy.body")}</p>
      </Section>

      <Section title={t("about.tech.title")}>
        <p>{t("about.tech.body")}</p>
        <p className="mt-2">
          {t("about.tech.source")}{" "}
          <a
            href="https://github.com/shillbom/badabadahavet"
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-wave-700 underline hover:text-wave-800"
          >
            GitHub
          </a>
          .
        </p>
      </Section>

      <Section title={t("about.support.title")}>
        <p>{t("about.support.body")}</p>
        <a
          href={SWISH_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 flex items-center justify-center gap-2 rounded-full bg-gradient-to-br from-pink-500 to-rose-500 px-4 py-2.5 text-sm font-bold text-white shadow-md transition hover:from-pink-600 hover:to-rose-600 active:scale-[0.98]"
        >
          <span className="text-base">🍻</span>
          {t("about.support.cta")}
        </a>
      </Section>

      <div className="mt-8 text-center text-xs text-slate-500">
        <p>
          {t("about.created_by")}{" "}
          <a
            href="https://www.linkedin.com/in/simon-hillbom/"
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-wave-700 underline hover:text-wave-800"
          >
            Simon Hillbom
          </a>
        </p>
      </div>
      <div className="mt-3 text-center text-xs text-slate-500">
        <Link to="/profile" className="hover:underline">
          ← {t("profile.title")}
        </Link>
      </div>
    </div>
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
