import { useEffect, useRef, type ReactNode } from "react";
import { IconCheck } from "./icons";

export interface DeviceGroup {
  label: string;
  kind: MediaDeviceKind;
  devices: MediaDeviceInfo[];
  selectedId: string;
  onSelect: (deviceId: string) => void;
  fallbackLabel: string;
}

/**
 * Menu ancorado ao chevron dos controles de chamada, no padrão do Discord:
 * lista os dispositivos por categoria com a opção ativa marcada.
 */
export function DeviceMenu({
  groups,
  footer,
  onClose,
}: {
  groups: DeviceGroup[];
  footer?: ReactNode;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menuRef.current && !menuRef.current.contains(target)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    // `pointerdown` no capture evita que o clique que abre o próximo menu
    // seja engolido pelo fechamento deste.
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  return (
    <div className="device-menu" role="menu" ref={menuRef}>
      {groups.map((group) => (
        <div className="device-menu-group" key={group.kind + group.label}>
          <span className="device-menu-label">{group.label}</span>
          <button
            role="menuitemradio"
            aria-checked={!group.selectedId}
            className={!group.selectedId ? "selected" : ""}
            onClick={() => {
              group.onSelect("");
              onClose();
            }}
          >
            <span className="device-check">
              {!group.selectedId && <IconCheck size={15} />}
            </span>
            <span>Padrão do sistema</span>
          </button>
          {group.devices.map((device, index) => (
            <button
              key={device.deviceId || `${group.kind}-${index}`}
              role="menuitemradio"
              aria-checked={group.selectedId === device.deviceId}
              className={group.selectedId === device.deviceId ? "selected" : ""}
              onClick={() => {
                group.onSelect(device.deviceId);
                onClose();
              }}
            >
              <span className="device-check">
                {group.selectedId === device.deviceId && <IconCheck size={15} />}
              </span>
              <span>
                {device.label || `${group.fallbackLabel} ${index + 1}`}
              </span>
            </button>
          ))}
          {group.devices.length === 0 && (
            <p className="device-menu-empty">
              Nenhum dispositivo detectado. Conceda a permissão de mídia para
              ver os nomes.
            </p>
          )}
        </div>
      ))}
      {footer}
    </div>
  );
}
