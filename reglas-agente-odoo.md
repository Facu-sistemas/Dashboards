# Reglas para el agente — Integración con Odoo

Este documento reúne lecciones aprendidas trabajando con la API de Odoo desde la web (Astro + islas React). El agente debe tenerlas en cuenta siempre que programe algo que lea o escriba datos de Odoo.

---

## 1. Idioma (`lang`) — SIEMPRE explícito en el contexto

**Regla:** toda llamada a Odoo vía `/jsonrpc` (o cualquier endpoint RPC) debe fijar `lang: 'es_AR'` en el contexto de la petición.

**Por qué:**
- Cuando entrás a Odoo por el navegador, la sesión usa tu idioma (`es_AR`) automáticamente.
- El endpoint RPC genérico **no hace esto solo** — si no le pasás el contexto, devuelve los campos traducibles en el idioma base de la base de datos (`en_US`), que puede estar desactualizado.
- Un mismo producto puede tener traducciones distintas y desincronizadas entre idiomas (ej: nombre en inglés desactualizado vs. nombre en español correcto y vigente). Esto genera bugs silenciosos: no tira error, simplemente muestra el dato viejo.

**Cómo aplicarlo:**
- Centralizar el `lang: 'es_AR'` en el cliente de Odoo (ej. `client.ts`), no repetirlo llamada por llamada — así no depende de que cada desarrollador se acuerde.
- Cualquier módulo nuevo que muestre nombres de producto, categoría, o cualquier campo traducible, hereda automáticamente este fix si pasa por el cliente centralizado.

**Antes de dar por resuelto un bug de "dato viejo/incorrecto" que venga de Odoo:** verificar primero si el contexto de la llamada tiene el `lang` seteado. Es la primera sospecha, no la última.

---

## 2. Verificar contra Odoo real antes de pushear

No alcanza con que el código "tenga sentido" — antes de subir un fix que toca datos de Odoo, correr la consulta real (shell o llamada directa) y confirmar que el valor que trae coincide con lo que se ve en la interfaz de Odoo. Documentar esa verificación en el commit/resumen.

---

## 3. Pensar en el alcance real del bug, no solo en el caso puntual

Si un bug aparece en un módulo puntual (ej. reporte de Bandas) pero la causa es estructural (ej. falta de contexto de idioma en el cliente), el fix se aplica a nivel del cliente/capa compartida, no parcheando el módulo puntual. Cualquier otro lugar que use el mismo cliente para traer datos traducibles de Odoo podía tener el mismo problema de forma silenciosa.

---

## 4. Nunca exponer la API key del lado del cliente

Las llamadas a Odoo deben hacerse siempre desde el backend/servidor (o una función serverless), nunca directo desde JS que corre en el navegador del usuario. Exponer la key en el cliente la deja visible para cualquiera que abra las herramientas de desarrollador.

---

*(Agregar acá futuras reglas/lecciones a medida que aparezcan casos nuevos)*
