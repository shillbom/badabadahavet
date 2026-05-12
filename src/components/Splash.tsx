import { motion } from "framer-motion";

export function FullSplash() {
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-3">
      <div className="relative h-20 w-20">
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            initial={{ scale: 0.5, opacity: 0.5 }}
            animate={{ scale: 1.6, opacity: 0 }}
            transition={{
              duration: 1.6,
              delay: i * 0.4,
              repeat: Infinity,
              ease: "easeOut",
            }}
            className="absolute inset-0 rounded-full border-2 border-wave-400"
          />
        ))}
        <motion.img
          src="/web-app-manifest-192x192.png"
          alt="Badligan"
          animate={{ y: [0, -6, 0] }}
          transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
          className="absolute inset-0 h-full w-full rounded-full object-cover"
        />
      </div>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.2 }}
        className="font-display text-sm font-bold tracking-widest text-wave-700 uppercase"
      >
        Badligan
      </motion.div>
    </div>
  );
}
