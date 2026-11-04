# Pase de fichado CrossCheck → Odoo: respuestas de Sistemas

**Para:** Juan (RRHH)
**De:** Facu (Sistemas)
**Fecha:** 26/10/2026
**Responde a:** `pedido-info-facu-fichado-odoo.md`

Marqué cada respuesta así: ✅ ya está hecho y funcionando · 🟡 se puede, falta configurarlo o decidirlo · ❌ hoy no está.
Lo que dice "[Facu: …]" lo completo yo antes de mandarte este archivo.

---

## Resumen corto (lo que más te importa)

- **Jornada de 8,80 hs:** ✅ el tab nuevo **RRHH → Quincena** ya computa **8,80 hs por día** y **96,80 hs en una quincena de 11 días hábiles**. No depende de la jornada de Odoo (8,3). Las licencias por días se convierten a **8,80 hs por día**.
- **Tab Quincena + Excel:** ✅ ya corta por quincena, muestra por empleado jornada, feriados, tiempo personal por tipo, banco de horas y marca lo que no cierra. El Excel sale con un clic, con **todos los empleados activos**, con legajo, en decimal y hh:mm, una columna por concepto y **sin valores negativos**.
- **Lo que falta para el 01/11** (detalle abajo): fichar con **todos** (hay que registrar las caras de la planta), completar convenio / centro de costo / supervisor en los legajos (hoy faltan), mapear los tipos de ausencia a códigos INFOCOR (necesito tu columna de códigos), y que me pases la `BASE RELOJ FICHADOR` de ejemplo (**no venía adjunta**) para igualar las columnas exactas.
- **Mi propuesta de fecha:** arrancar el paralelo el **16/11 (2Q noviembre)**, salvo que para el 01/11 estén registradas las caras de todos y resuelto el fichado sin internet. Si no, la comparación de la 1Q no va a servir. *[Facu: confirmar]*

---

## 2. Estado de la implementación

**1. Versión de Odoo.** Odoo **17.0 Enterprise** (`17.0+e`). *[Facu: completar si es Odoo Online, Odoo.sh o servidor propio]*

**2. Qué está listo y qué falta.**

| Tema | Estado |
| :--- | :--- |
| Fichaje por reconocimiento facial (celular, modo quiosco) escribiendo en Asistencias de Odoo | ✅ funcionando |
| Aviso de privacidad del fichaje facial (pestaña dentro de Fichaje) | ✅ publicado |
| Tab RRHH → Quincena (conciliación) y Excel de salida | ✅ funcionando (se ajusta cuando me pases la BASE RELOJ) |
| Tab RRHH → Vacaciones y Resumen (saldos, banco de horas) | ✅ funcionando |
| Registrar las caras de **todo** el personal | 🟡 *[Facu: completar cuántos están registrados]* |
| Legajos con convenio, centro de costo y supervisor | 🟡 incompleto (ver punto 13) |
| Tipos de ausencia mapeados a INFOCOR | 🟡 espera tu columna de códigos (punto 27) |
| Fichar sin internet | ❌ no está (punto 7) |
| Método alternativo si falla la cara | ❌ no está (punto 8) |
| Cálculo de extras, llegadas tarde y presentismo a partir de fichadas reales | ❌ falta: hoy hay solo fichadas de prueba |

**3. App de reconocimiento facial.** Es un **desarrollo propio**, no es de Odoo ni de un tercero. Corre en el navegador del celular. Reconoce la cara en el mismo celular y, cuando la persona aprieta **Fichar**, crea o cierra la asistencia en Odoo **en tiempo real** (modo "quiosco"). No hay sincronización diferida ni importación.

**4. Desarrollo a medida.** Sí: el fichaje facial y el tab Quincena son desarrollo a medida. Lo demás (ausencias, banco de horas, vacaciones) es Odoo estándar con campos propios.

**5. Cronograma.** Propuesta: paralelo desde el 16/11, dos quincenas de comparación, y decisión de apagar el CrossCheck después de la 2Q de diciembre si se cumple la meta del punto 52. *[Facu: confirmar fechas]*

---

## 3. Dispositivos y fichada

**6. Los 3 celulares.** Cada celular entra con un usuario propio de quiosco que **solo ve el módulo de Fichaje**: la cámara arranca sola, pantalla completa y pantalla siempre encendida. 🟡 Falta definir dónde queda cada uno y bloquearlos físicamente para otros usos (modo kiosco del sistema del celular). *[Facu: ubicaciones]*

**7. Sin internet.** ❌ **Hoy no guarda la fichada sin conexión**: la cara se reconoce en el celular, pero la marca se manda a Odoo al apretar Fichar; sin internet no se registra y la persona tiene que repetir. La hora de la marca es la del **servidor al recibirla**, no la del celular. Esto se puede mejorar (guardar en el celular y subir después con la hora original) pero es desarrollo. Mientras tanto, recomiendo que cada punto tenga internet estable o datos móviles de respaldo.

**8. Si falla el reconocimiento.** ❌ Hoy no hay método alternativo en nuestra app. Odoo trae el fichaje por **credencial / PIN** en su quiosco nativo (los legajos tienen credencial cargada, ver punto 12). Propuesta: habilitar ese quiosco de Odoo como respaldo, o que RRHH cargue la asistencia a mano con motivo (punto 42). *[Facu: decidir cuál]*

**9. Doble fichada o salida sin fichar.** El botón alterna: si la persona está adentro, **cierra** la asistencia; si está afuera, **abre** una. Dos fichadas seguidas dan una entrada y una salida casi juntas (se ve como una asistencia de segundos). 🟡 No hay cierre automático ni aviso configurado todavía; Odoo tiene un cierre automático por exceso de horas que podemos activar. El reporte puede listar las asistencias abiertas o muy cortas para que RRHH las corrija.

**10. Desde qué celular fichó.** ❌ Hoy no se guarda qué celular o punto. Se registra el modo (quiosco). Se puede agregar un identificador por punto de fichado.

**11. Impedir otros dispositivos.** 🟡 El fichaje se hace con un usuario de quiosco; si iniciamos sesión solo en los 3 celulares autorizados y no se comparte la clave, nadie más puede fichar. No hay una restricción técnica por dispositivo; se podría agregar.

---

## 4. Legajos y datos maestros

**12. Número de legajo.** Cada empleado tiene en Odoo el **CUIL** (cargado en los 132 activos) y un **número de credencial con formato `01/0602`** (cargado en 122 de 132). El Excel de salida usa esa credencial como **Legajo**. ⚠️ **Necesito que confirmes si `01/0602` es el legajo de INFOCOR** (en el ejemplo que vi, la empresa `01` y el legajo `0602`). Faltan 10 sin credencial: Bermudez Bruno, Bono Franco, Campo Eduardo Víctor, Civile Tomás, Corvalán Renzo Patricio, Eyvastre Ignacio Andrés, Luna Eduardo, Miranda Mario, Moreno Omar, Valle Mauricio.

**13. Convenio, categoría, sector, centro de costo y supervisor.** 🟡 Incompleto hoy, sobre 132 empleados activos:

| Dato | Cargados |
| :--- | :---: |
| Supervisor (gerente) | 130 |
| Fecha de ingreso | 124 |
| Centro de costo | 37 |
| Categoría de convenio | 36 |

Hay que completar **convenio (SOIVA / Madereros / FUVA / FC / pasante)** y **centro de costo** para el resto. Es dato que tiene RRHH: si me pasás una planilla legajo → convenio → centro de costo, lo cargo yo.

**14. Altas y bajas.** Las altas y bajas se hacen en Odoo (la baja es archivar al empleado, y deja de aparecer en el fichaje). La **cara** hay que cargarla al dar de alta y borrarla al dar de baja; ese borrado hoy es manual y lo hace Sistemas. *[Facu: decidir si lo automatizo con la baja]*

---

## 5. Horario y jornada (8,30 fichadas = 8,80 computadas)

**15. 8,80 hs.** ✅ Resuelto **en el reporte**, no en el horario de Odoo: el tab Quincena y el Excel computan **8,80 hs por día** fijo. Sigo viendo un riesgo: Odoo por sí solo mide las horas fichadas (6:00–14:18 = 8,30) y su cálculo nativo de extras se basa en la jornada de 8,3, así que **no lo usamos para extras**. Propuesta de regla para cuando haya fichadas reales: *día con jornada completa fichada = 8,80 hs* (se suma la media hora de descanso). **Necesito que me confirmes esa regla y a partir de qué horas fichadas se considera "jornada completa".**

**16. Tolerancia de entrada y salida.** Odoo tiene tolerancias de horas extra (a favor de la empresa y del empleado), pero no tolerancia de llegada tarde con la lógica que ustedes usan. Lo más simple es calcularlo en nuestro reporte con la regla de siempre (**más de 15 min = llegada tarde**). 🟡

**17. Redondeo.** Mismo criterio: la regla "excedente cuenta como extra recién pasados 30 minutos" la aplico en el reporte, no en Odoo. 🟡

**18. Feriados.** ✅ Están cargados en el calendario de la empresa de Odoo (próximos: 23/11, 08/12, 25/12). El tab los descuenta solos. Los mantiene Sistemas con lo que RRHH avise. ⚠️ En Odoo el feriado figura con 8,8 hs en la hoja de horas y la jornada nativa es 8,3; el reporte los cuenta siempre a 8,80.

**19. Trabajo en sábado.** Odoo registra la fichada cualquier día. El reporte puede marcar los días no hábiles trabajados en una columna aparte. 🟡 *(Hoy no hay fichadas reales para probarlo.)*

**20. Corte por quincena.** ✅ El tab Quincena corta 1–15 y 16–fin de mes sin armar nada a mano.

---

## 6. Horas extras y banco de horas

**21. Excedente sobre 8,80.** 🟡 Se calcula en nuestro reporte cuando haya fichadas reales (por día y por quincena). Todavía no está porque hoy solo hay fichadas de prueba.

**22. Excluir administrativos y casos puntuales.** 🟡 Sí: lo hago por **convenio / categoría**, no persona por persona. Depende de tener cargado el convenio (punto 13). Para los casos puntuales (Angulo, Francone, etc.) uso una marca en el empleado.

**23. Extra al 50% y al 100%.** 🟡 Odoo estándar no lo distingue. En el reporte se puede separar por día y horario (sábado después de las 13, domingo, feriado).

**24. Proponer "pagar" o "mandar a banco".** ❌ No está en Odoo estándar. Forma de resolverlo: el supervisor carga una solicitud de **Banco de horas** (que ya existe como tipo de ausencia/asignación) y RRHH la aprueba; lo que no se manda a banco queda como extra a pagar.

**25. Saldo del banco de horas.** ✅ Odoo lleva el saldo por empleado (asignaciones y consumos), y hay un campo de saldo. Hoy **cuadra para los 132 empleados** (saldo = asignado − tomado). El saldo inicial ya está cargado. El tab Quincena avisa si deja de cuadrar. ⚠️ Un día completo de banco de horas lo descuenta Odoo como 8,3 hs; el reporte lo cuenta a 8,80. Hay que definir con qué valor se descuenta el saldo.

**26. Quién aprobó y cuándo.** ✅ En las ausencias (incluido Banco de horas) Odoo guarda quién aprobó y cuándo. Para extras detectadas desde fichadas, 🟡 se registraría con la aprobación de RRHH en el reporte.

---

## 7. Ausencias e incidencias

**27. Tabla de tipos de ausencia.** Estos son los tipos que ya existen en Odoo. **Los códigos INFOCOR que no figuran en tu pedido necesito que los completes vos.**

| Incidencia | Código INFOCOR | Tipo de ausencia en Odoo | ¿Pide adjunto? |
| :--- | :---: | :--- | :---: |
| Enfermedad inculpable | 3 | Baja por enfermedad | Sí |
| Accidente de trabajo (ART) | 6 | Accidente | Sí |
| Vacaciones | 05 | Vacaciones | No |
| Matrimonio | *(vos)* | Matrimonio | Sí |
| Fallecimiento | *(vos)* | Fallecimiento | Sí |
| Maternidad | *(vos)* | Licencia por maternidad | Sí |
| Mudanza | *(vos)* | Mudanza | Sí |
| Donación de sangre | *(vos)* | Donación de sangre | Sí |
| Lactancia | *(vos)* | Lactancia | Sí |
| Bombero | *(vos)* | Bombero | Sí |
| Estudio | *(vos)* | Estudio | Sí |
| Trámite | *(vos)* | Tramite | Sí |
| Permiso gremial | *(vos)* | Permiso gremial | Sí |
| Día de convenio | *(vos)* | Dia convenio | Sí |
| Permiso sin goce | *(vos)* | Permisos sin pagar | Sí |
| Días compensatorios | *(vos)* | Días compensatorios | No |
| Tiempo personal pagado | *(vos)* | Tiempo personal pagado | No |
| Uso de banco de horas | — | Banco de horas | No |
| **Falta injustificada** | *(vos)* | **No existe todavía** (la crearía) | No |

Los números 21–30 que mencionás los asigno cuando me digas cuál corresponde a cada licencia especial.

**28. Supervisor carga, RRHH aprueba.** 🟡 Odoo maneja estados: pendiente → aprobada. Los tipos hoy están configurados con distintas aprobaciones (por ejemplo, Banco de horas y las licencias especiales las aprueba RRHH). Hay que revisar los permisos de supervisores. El tab Quincena **muestra las licencias sin aprobar** como aviso amarillo y no las suma al tiempo personal hasta que se aprueban.

**29. Adjuntos.** ✅ Sí, los tipos marcados "Sí" arriba piden adjunto.

**30. Una ausencia aprobada evita la falta.** ✅ En nuestro reporte sí: lo que no es jornada fichada, feriado ni licencia aprobada queda como diferencia a revisar. Eso evita el error de auditoría de "vacaciones cargadas como faltas".

**31. Horas o días (8,80 hs por día).** ✅ El tab convierte las licencias **por día a 8,80 hs/día** (2 días = 17,60; 5 días = 44,00) y respeta las licencias cargadas **por hora** tal cual.

**32. Vacaciones: 5 días hábiles se pagan como 7 corridos.** 🟡 Odoo cuenta solo los días hábiles. Lo resuelvo en el reporte (cada bloque de 5 hábiles consecutivos suma sábado y domingo) o lo dejamos en Excel; **decime cuál preferís**. *(No está implementado todavía.)*

**33. Días de vacaciones por antigüedad.** ✅ Odoo lleva los días asignados y descuenta los tomados; el tab **Vacaciones** muestra el saldo por empleado y marca los negativos y los saldos muy altos. El saldo inicial ya está cargado.

**34. Ausencia cargada después del cierre.** ⚠️ El tab recalcula siempre con lo que hay en Odoo en ese momento, así que si se carga tarde, la quincena cambia. No hay bloqueo (ver punto 44). Mitigación: al cerrar la quincena **bajar el Excel y guardarlo** como foto del cierre.

---

## 8. Presentismo

**35. Qué puede hacer Odoo.** Recomiendo la opción **a**: Odoo (y nuestro reporte) **informa** por empleado y quincena las llegadas tarde, salidas anticipadas y ausencias por tipo, y los puntos de presentismo se siguen calculando en Excel. Calcular los puntos dentro del sistema es desarrollo adicional que se puede hacer una vez que el paralelo muestre que las fichadas son confiables. ❌ Llegadas tarde y salidas anticipadas **todavía no están** en el reporte (necesitan fichadas reales).

**36. Vacaciones nunca cuentan como ausencia.** ✅ Se puede garantizar: el reporte separa cada ausencia por tipo en su propia columna, así que Vacaciones nunca se mezcla con falta.

---

## 9. Reporte de salida (reemplazo de la `BASE RELOJ FICHADOR`)

**37. Mismas columnas que la BASE RELOJ FICHADOR.** 🟡 **El ejemplo de la 2Q no venía adjunto en el archivo que me pasaste.** El Excel de hoy sale con un clic desde **RRHH → Quincena → Descargar Excel**, con estas columnas: Legajo, CUIL, Empleado, Convenio, Centro de costo, Supervisor, Días hábiles, Horas de jornada, Feriados, una columna por cada tipo de ausencia, Tiempo personal total, Horas a trabajar, Fichadas (decimal y hh:mm), Banco acreditado / usado (decimal y hh:mm), Banco saldo a favor y en contra, Licencias sin aprobar y Diferencias. Con tu planilla de ejemplo reordeno y renombro las columnas para que se pegue sin rearmar.

**38. Decimal y hh:mm.** ✅ Las fichadas y el banco salen en decimal (8,80) y en hh:mm. Las extras en hh:mm entran cuando se calculen (punto 21).

**39. Cada concepto en su columna.** ✅ Cada tipo de ausencia tiene su propia columna; los anticipos no se mezclan con nada (el reporte no los incluye).

**40. Sin negativos.** ✅ Ningún valor sale negativo. El saldo del banco en contra va en una columna aparte, en positivo.

**41. Todos los empleados activos.** ✅ El Excel trae **todos los activos con legajo**, hayan fichado o no, y no aplica los filtros de pantalla.

---

## 10. Correcciones, permisos y trazabilidad (ISO 9001)

**42. Solo RRHH corrige, con motivo.** ❌ Hoy no está configurado. Se puede restringir con el grupo de permisos de Asistencias de Odoo (solo RRHH crea y edita). El **motivo obligatorio** requiere agregar un campo (desarrollo menor). *[Facu: confirmar plazo]*

**43. Historial de cambios.** 🟡 En las ausencias, Odoo guarda el chatter con quién cambió qué. En las asistencias hay que activar el seguimiento de cambios; hoy no queda el valor anterior. Lo pongo en la lista de pendientes.

**44. Bloquear una quincena.** ❌ No hay bloqueo nativo de asistencias ni ausencias por período. Alternativas: foto del cierre en Excel (punto 34) o desarrollo de un bloqueo por fecha.

**45. Roles.** 🟡 Los usuarios y áreas del dashboard ya se manejan por permisos. Falta definir con vos el esquema: RRHH ve todo, supervisor ve y carga solo su equipo (se apoya en el campo Supervisor del legajo, punto 13), gerencia ve resúmenes.

---

## 11. Datos biométricos

Ya está publicado el **Aviso de privacidad del fichaje facial** en la pestaña de Fichaje. Resumo.

**46. Dónde se guardan.** **No se guardan fotos ni videos.** Solo una **plantilla numérica** (5 por persona, de 128 números cada una) que no se puede convertir en imagen. Está en una base de datos en un proveedor de nube con acceso solo del servidor del sistema y comunicación cifrada. El celular no guarda las plantillas de forma permanente. *[Facu: completar proveedor y país del servidor]*

**47. Quién accede.** Solo administradores de Sistemas ven la lista de personas registradas (nombre, cantidad de muestras, fecha). La pantalla no muestra las plantillas. El celular de fichaje no puede borrar registros.

**48. Al dar de baja.** La plantilla se elimina al terminar la relación laboral, al dejar de usar el fichaje o si la persona lo pide. Hoy el borrado lo hace Sistemas a mano (punto 14).

**49. Política del proveedor.** *[Facu: pasar enlace al contrato / política de privacidad del proveedor de la base de datos]*

**50. Consentimiento.** 🟡 El aviso de privacidad existe, pero **el consentimiento firmado por cada persona lo tiene que armar RRHH / legales**. Sugiero que el aviso (que ya describe qué se guarda, para qué, quién accede y los derechos de la Ley 25.326) se entregue junto con la firma antes de registrar las caras de toda la planta.

---

## 12. Paralelo y corte

**51. Durante el paralelo.** Todos fichan en el CrossCheck **y** en Odoo. Hay que comunicar a la planta que se ficha dos veces durante la prueba y que el CrossCheck sigue siendo el que vale para liquidar. Texto sugerido para el comunicado: lo armo yo si querés.

**52. Quién compara y con qué criterio.** Estoy de acuerdo con tu propuesta (≥ 97 % de coincidencia por empleado, diferencias explicadas). La comparación se arma con el Excel de Quincena contra la BASE RELOJ. Quién compara: RRHH con apoyo mío. *[Facu: confirmar]*

**53. Condiciones para apagar el CrossCheck.** Propuesta: dos quincenas seguidas con ≥ 97 %, todas las diferencias explicadas, punto 7 y 8 resueltos (sin internet y método alternativo), y cierre por escrito de RRHH. La decisión es tuya (RRHH).

**54. Histórico del CrossCheck.** Sí: exportar y guardar todo el histórico antes de apagarlo. Sugiero guardarlo junto con las bases de liquidación en la carpeta de RRHH. *[Facu: definir dónde]*

**55. Contingencia.** Si Odoo falla en una quincena de liquidación: el CrossCheck sigue vigente durante todo el paralelo, y después se liquida con la última exportación del Excel de Quincena más la carga manual de RRHH.

---

## 13. Soporte y capacitación

**56. Soporte en el momento.** *[Facu: definir quién atiende desde las 6:00 y por qué canal]* Mientras dure el paralelo recomiendo tener a alguien de Sistemas disponible a las 6:00 la primera semana.

**57. Capacitación de supervisores.** 🟡 No hay instructivo todavía. Lo armo (carga de incidencias y lectura del tab Quincena) y lo dicto antes del paralelo.

---

## Lo que necesito de vos (Juan)

1. La `BASE RELOJ FICHADOR` de ejemplo (la 2Q) — no venía adjunta.
2. Confirmar si la credencial `01/0602` es el legajo de INFOCOR.
3. Códigos INFOCOR de cada licencia (punto 27) y si creo el tipo "Falta injustificada".
4. Planilla legajo → convenio → centro de costo para completar los legajos.
5. Regla de "jornada completa = 8,80 hs" y cómo querés tratar las vacaciones de 7 días corridos (puntos 15 y 32).
6. Consentimiento de datos biométricos para el personal.
