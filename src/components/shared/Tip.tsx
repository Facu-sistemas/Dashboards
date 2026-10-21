import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** Tooltip al pasar el mouse. Posición fija para que no lo recorte el scroll de las tablas. (Mismo patrón que Calidad CNC.) */
export default function Tip({ text, children, className }: { text: string; children: ReactNode; className?: string }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  return (
    <span
      className={className}
      onMouseEnter={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        setPos({ x: Math.max(8, Math.min(r.left, window.innerWidth - 340)), y: r.bottom + 6 });
      }}
      onMouseLeave={() => setPos(null)}
    >
      {children}
      {pos &&
        createPortal(
          <span
            className="pointer-events-none fixed z-50 w-80 whitespace-pre-line rounded-md border border-slate-600 bg-slate-950 p-3 text-left text-xs font-normal normal-case leading-relaxed text-slate-200 shadow-xl"
            style={{ left: pos.x, top: pos.y }}
          >
            {text}
          </span>,
          document.body,
        )}
    </span>
  );
}
