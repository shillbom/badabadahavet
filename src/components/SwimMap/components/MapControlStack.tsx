import { Layers } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import type { MapAction, MapMenuToggle } from "../types";
import MapActionButton from "./MapActionButton";
import MapFilterMenu from "./MapFilterMenu";

/**
 * Top-right control stack: caller-supplied actions plus the built-in
 * satellite toggle — collapsed into a single ⋯ filter menu when
 * `menuToggles` is supplied. In fullscreen the stack drops below the
 * search bar.
 */
export default function MapControlStack({
  menuToggles,
  satellite,
  setSatellite,
  topRightActions,
  fullscreen,
}: {
  menuToggles?: MapMenuToggle[];
  satellite: boolean;
  setSatellite: React.Dispatch<React.SetStateAction<boolean>>;
  topRightActions?: MapAction[];
  fullscreen: boolean;
}) {
  const t = useT();
  return (
    <div
      className={cn(
        "absolute right-3 z-[600] flex flex-col items-end gap-2",
        fullscreen
          ? "top-[calc(max(env(safe-area-inset-top),0.75rem)+3.5rem)]"
          : "top-3",
      )}
    >
      {menuToggles && menuToggles.length > 0 ? (
        <MapFilterMenu
          ariaLabel={t("map.filters")}
          toggles={[
            ...menuToggles,
            {
              label: t("map.toggle_satellite"),
              checked: satellite,
              onChange: setSatellite,
              icon: <Layers className="h-3.5 w-3.5" />,
            },
          ]}
        />
      ) : (
        <>
          {topRightActions?.map((a) => (
            <MapActionButton key={a.label} action={a} />
          ))}
          <MapActionButton
            action={{
              label: satellite
                ? t("map.toggle_terrain")
                : t("map.toggle_satellite"),
              onClick: () => setSatellite((v) => !v),
              icon: <Layers className="h-3.5 w-3.5" />,
            }}
          />
        </>
      )}
    </div>
  );
}
