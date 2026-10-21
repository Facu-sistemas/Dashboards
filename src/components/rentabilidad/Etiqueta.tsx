import { createContext, useContext, type ReactNode } from 'react';
import Tip from '@/components/shared/Tip';
import { textoGlosario, type ClaveGlosario, type ContextoGlosario } from '@/lib/rentabilidad/glosario';

const Ctx = createContext<ContextoGlosario | null>(null);

/** Informa a las etiquetas qué modo de costos y qué empresa están activos, para que el hover lo diga. */
export function GlosarioProvider({ value, children }: { value: ContextoGlosario; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Texto con subrayado punteado que explica, al pasar el mouse, de dónde sale el dato (textos en glosario.ts). */
export default function Etiqueta({ clave, children }: { clave: ClaveGlosario; children: ReactNode }) {
  const ctx = useContext(Ctx);
  return (
    <Tip text={textoGlosario(clave, ctx)} className="cursor-help border-b border-dotted border-slate-500">
      {children}
    </Tip>
  );
}
