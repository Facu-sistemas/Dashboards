# Facturas por WhatsApp: mensajes que no llegaban (14/10/2026)

Relacionado con el ticket #60785 (módulo `whatsapp_batch_delay`).

## Problema
Al enviar varias facturas seguidas al mismo cliente por WhatsApp, algunas no llegaban. En Odoo todos los mensajes figuraban como `sent`, sin errores. Ejemplo: un cliente con 5 facturas recibió solo 3. Subir la pausa entre mensajes hasta 7 segundos no cambió nada.

## Causa
Las dos plantillas usadas para enviar facturas estaban categorizadas como **Marketing** en Meta:

- `Presupuesto WhatsApp Odoo` (facturas que empiezan con `INV`)
- `Factura WhatsApp Odoo` (facturas que empiezan con `FC` o `EXP`)

Meta limita la cantidad de mensajes de marketing que recibe una misma persona. La API acepta el envío y devuelve un `wamid`, pero después descarta algunos sin avisar (error 131049, "healthy ecosystem engagement"). Por eso la pausa entre mensajes no servía: el límite no depende del tiempo entre mensajes.

Odoo no se entera del descarte porque no registra estados `delivered`, `read` ni `failed`. En la base solo existen `sent` (342) y `error` (528).

Nota: la causa se infirió a partir de los datos de Odoo. No se verificó el error 131049 directamente en WhatsApp Manager.

## Qué se hizo
1. Se creó una copia de cada plantilla con categoría **Utilidad** y nombre técnico nuevo. Meta no permite cambiar la categoría de una plantilla ya aprobada, por eso hubo que crear plantillas nuevas.

   | Nombre en Odoo | Nombre técnico | Categoría |
   |---|---|---|
   | Factura WhatsApp Odoo (Utilidad) | `factura_whatsapp_odoo_utilidad` | Utilidad |
   | Presupuesto WhatsApp Odoo (Utilidad) | `presupuesto_whatsapp_odoo_utilidad` | Utilidad |

2. Meta aprobó las dos manteniendo la categoría Utilidad.
3. Se editó la acción de servidor **Enviar Facturas por WhatsApp** (id 1210, modelo `account.move`). Las dos primeras líneas del código quedaron así:

   ```python
   plantilla_presupuesto = 'Presupuesto WhatsApp Odoo (Utilidad)'
   plantilla_factura     = 'Factura WhatsApp Odoo (Utilidad)'
   ```

   La acción busca la plantilla por **nombre exacto**, así que el nombre en Odoo debe coincidir con estas líneas.

4. Se probó con un lote de facturas y llegaron todas.

## Dónde está cada cosa en Odoo
- Plantillas: WhatsApp → Plantillas.
- Acción de envío: Ajustes (modo desarrollador) → Técnico → Acciones → Acciones de servidor → "Enviar Facturas por WhatsApp".
- Cómo se envía: seleccionar facturas en la lista → Acciones → "Enviar Facturas por WhatsApp".

## Pendientes
- **Teléfonos inválidos:** hay más de 500 mensajes con error `phone_invalid`. Son contactos con el móvil mal cargado (por ejemplo `(3564) 3564660874`, con el código de área repetido, o sin número). Esos clientes no reciben nada.
- **Webhook de estados:** revisar que el webhook de WhatsApp apunte a Odoo, para que queden registrados `delivered`, `read` y `failed`.
- **Pausa del módulo:** evaluar si se vuelve a la pausa normal de `whatsapp_batch_delay`, ya que los 7 segundos probablemente no hagan falta.
- **Ticket #60785:** avisar que la causa era la categoría de las plantillas y no el módulo.
- **Plantillas viejas:** las dos plantillas de marketing siguen aprobadas en Odoo y Meta, pero ya no las usa ninguna acción.
