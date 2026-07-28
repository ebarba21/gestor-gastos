// Guia de uso de la app. Contenido estatico (sin acceso a datos): explica el flujo cotidiano,
// que hace cada seccion, los casos especiales (transferencias, duplicados, reembolsos) y
// preguntas frecuentes. Local-first: no hace ninguna llamada de red. Los textos visibles
// llevan tildes y ñ (convencion de UI); el codigo y los comentarios, no.
import type { ReactNode } from 'react';

// Bloque con titulo y contenido. Ancla opcional para el indice navegable.
function Block({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-4 rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
      <h3 className="text-lg font-semibold text-slate-100">{title}</h3>
      <div className="mt-3 space-y-3 text-sm leading-relaxed text-slate-300">{children}</div>
    </section>
  );
}

// Fila de "que hace cada seccion": nombre + descripcion corta.
function SectionRow({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-slate-800/70 py-2 last:border-b-0 sm:flex-row sm:gap-3">
      <span className="shrink-0 font-medium text-slate-100 sm:w-44">{name}</span>
      <span className="text-slate-400">{children}</span>
    </div>
  );
}

// Pregunta frecuente: pregunta en negrita + respuesta.
function Faq({ q, children }: { q: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
      <p className="font-medium text-slate-100">{q}</p>
      <p className="mt-1 text-slate-400">{children}</p>
    </div>
  );
}

// Paso numerado dentro de un flujo.
function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-xs font-semibold text-white">
        {n}
      </span>
      <div>
        <p className="font-medium text-slate-100">{title}</p>
        <p className="mt-0.5 text-slate-400">{children}</p>
      </div>
    </div>
  );
}

const TOC: { id: string; label: string }[] = [
  { id: 'que-es', label: 'Qué es esta app' },
  { id: 'primeros-pasos', label: 'Primeros pasos' },
  { id: 'dia-a-dia', label: 'El día a día' },
  { id: 'secciones', label: 'Qué hace cada sección' },
  { id: 'casos', label: 'Casos especiales' },
  { id: 'copias', label: 'Copias de seguridad' },
  { id: 'instalar', label: 'Instalar y actualizar' },
  { id: 'faq', label: 'Preguntas frecuentes' },
];

export function GuideSection() {
  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-100">Guía de uso</h2>
        <p className="mt-1 text-sm text-slate-400">
          Cómo sacarle partido a la app en tu día a día: el flujo mensual, qué mirar en cada
          sección y respuestas a las dudas más habituales.
        </p>
      </div>

      {/* Indice navegable. Enlaces internos a cada bloque. */}
      <nav className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Contenido
        </p>
        <ul className="grid grid-cols-1 gap-1 text-sm sm:grid-cols-2">
          {TOC.map((t) => (
            <li key={t.id}>
              <a href={`#${t.id}`} className="text-indigo-400 hover:text-indigo-300 hover:underline">
                {t.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <Block id="que-es" title="Qué es esta app">
        <p>
          Es un gestor de gastos <strong>local-first</strong>: todos tus datos viven en tu
          dispositivo (en el navegador), no en un servidor. Funciona sin conexión y, en modo
          local, ningún dato financiero sale de tu equipo.
        </p>
        <p>
          Puedes tener varios <strong>perfiles</strong> independientes (por ejemplo, personal y
          compartido). Cada perfil está aislado: nunca se mezclan sus datos.
        </p>
        <p>
          La <strong>sincronización</strong> entre dispositivos es opcional. Si la activas con una
          cuenta, solo se sincronizan los datos procesados, de forma privada. Si no la activas, la
          app es 100% local.
        </p>
      </Block>

      <Block id="primeros-pasos" title="Primeros pasos">
        <div className="space-y-3">
          <Step n={1} title="Crea o elige tu perfil">
            Al abrir la app eliges el perfil activo. Puedes crear más desde el selector de perfil
            (arriba a la izquierda).
          </Step>
          <Step n={2} title="Crea tus cuentas bancarias">
            En <strong>Cuentas bancarias</strong> añade tus fuentes de dinero (banco, tarjeta,
            efectivo, Revolut...). Son el destino de cada movimiento y hacen falta antes de
            importar.
          </Step>
          <Step n={3} title="Revisa tus categorías">
            En <strong>Categorías</strong> tienes una estructura inicial que puedes ajustar. Sirven
            para clasificar el gasto y que el dashboard sea útil.
          </Step>
          <Step n={4} title="Importa tu primer extracto">
            En <strong>Importar</strong> sube el CSV o XLSX del banco y mapea las columnas. Ya
            tienes datos que analizar.
          </Step>
        </div>
      </Block>

      <Block id="dia-a-dia" title="El día a día (flujo mensual recomendado)">
        <p>Una rutina sencilla cada vez que quieras poner al día tus cuentas:</p>
        <div className="space-y-3">
          <Step n={1} title="Mira hasta qué fecha tienes datos">
            En <strong>Cuentas bancarias</strong>, bajo cada cuenta, verás "Último movimiento:
            fecha". Descarga del banco el extracto desde el día siguiente a esa fecha.
          </Step>
          <Step n={2} title="Importa el extracto">
            <strong>Importar</strong> &rarr; elige el fichero &rarr; carga la plantilla del banco (o
            mapea las columnas la primera vez) &rarr; revisa duplicados &rarr; confirma. No hace
            falta editar el archivo: la app detecta el separador y evita duplicados.
          </Step>
          <Step n={3} title="Pasa por la Bandeja de revisión">
            Ahí la app te propone tareas: movimientos sin categoría, comercios nuevos, posibles
            duplicados y <strong>transferencias entre tus cuentas</strong>. Confirma o descarta con
            un clic.
          </Step>
          <Step n={4} title="Consulta el Dashboard">
            Revisa ingresos, gastos, ahorro y las categorías donde más gastas en el periodo.
          </Step>
        </div>
      </Block>

      <Block id="secciones" title="Qué hace cada sección">
        <div>
          <SectionRow name="Dashboard">
            Resumen del periodo: ingresos, gastos, ahorro, gasto por categoría y próximas cargas.
          </SectionRow>
          <SectionRow name="Movimientos">
            Lista completa de tus movimientos. Filtra por cuenta, categoría, fecha o importe;
            edita, divide o marca transferencias y reembolsos.
          </SectionRow>
          <SectionRow name="Importar">
            Sube extractos CSV/XLSX, mapea columnas, guarda plantillas por banco y controla
            duplicados.
          </SectionRow>
          <SectionRow name="Bandeja de revisión">
            Tareas pendientes que la app detecta: sin categorizar, comercios nuevos, duplicados y
            transferencias/reembolsos candidatos.
          </SectionRow>
          <SectionRow name="Categorías">
            Estructura de categorías y subcategorías (un nivel) para clasificar el gasto.
          </SectionRow>
          <SectionRow name="Reglas">
            Autocategorización: si el concepto cumple una condición, asigna categoría
            automáticamente al importar.
          </SectionRow>
          <SectionRow name="Comercios">
            Normaliza nombres de comercio (el concepto bancario original nunca se pierde) para
            agrupar el gasto por comercio real.
          </SectionRow>
          <SectionRow name="Cuentas bancarias">
            Tus fuentes de dinero, su saldo inicial y hasta qué fecha tienes datos de cada una.
          </SectionRow>
          <SectionRow name="Presupuestos">
            Límites de gasto por categoría o ámbito y su seguimiento en el periodo.
          </SectionRow>
          <SectionRow name="Recurrencias">
            Detecta y agrupa cargos periódicos (suscripciones, recibos) para anticiparlos.
          </SectionRow>
          <SectionRow name="Deudas">
            Préstamos y su amortización, con comparador de estrategias (bola de nieve / avalancha).
          </SectionRow>
          <SectionRow name="Conciliación">
            Cuadra tus movimientos con el saldo real del banco para detectar descuadres.
          </SectionRow>
          <SectionRow name="Exportar">
            Copias de seguridad y exportaciones (CSV/XLSX) de tus datos.
          </SectionRow>
          <SectionRow name="Mi cuenta">
            Gestión de la cuenta para la sincronización opcional entre dispositivos.
          </SectionRow>
          <SectionRow name="Sincronización">
            Estado y control de la sincronización privada (si la activas).
          </SectionRow>
          <SectionRow name="Ajustes / Seguridad">
            Preferencias generales, tema, PIN y bloqueo de la app.
          </SectionRow>
        </div>
      </Block>

      <Block id="casos" title="Casos especiales">
        <p>
          <strong>Transferencias entre tus cuentas.</strong> Si mueves dinero de una cuenta a otra
          (por ejemplo, del banco a Revolut), aparecen un gasto en origen y un ingreso en destino
          que <em>no</em> son gasto ni ingreso reales. Márcalos como <strong>transferencia</strong>
          {' '}(la Bandeja de revisión suele proponerlo): dejan de contar en las estadísticas pero
          se conservan, así los saldos siguen cuadrando. <strong>No los borres a mano</strong>: son
          movimientos bancarios reales.
        </p>
        <p>
          <strong>Duplicados.</strong> Si reimportas un extracto que solapa fechas ya cargadas, la
          app detecta los duplicados y no los repite. Puedes excluirlos de un vistazo en la vista
          previa de la importación.
        </p>
        <p>
          <strong>Reembolsos.</strong> Una devolución (te reingresan parte de una compra) se enlaza
          al gasto original: reduce el gasto neto de esa categoría en vez de contarse como un
          ingreso, que inflaría tus ingresos.
        </p>
        <p>
          <strong>Divisiones (splits).</strong> Un único cargo que corresponde a varias categorías
          (por ejemplo, una compra con parte hogar y parte ocio) se puede dividir en líneas, cada
          una con su categoría.
        </p>
      </Block>

      <Block id="copias" title="Copias de seguridad">
        <p>
          Como tus datos viven en tu dispositivo, conviene exportar una copia de vez en cuando.
          Desde <strong>Exportar</strong> puedes descargar un backup completo del perfil y
          restaurarlo cuando lo necesites (por ejemplo, tras empezar de cero o en otro dispositivo).
        </p>
        <p>
          Ten presente que borrar los datos del sitio en el navegador (o desinstalar) elimina la
          base local: guarda un backup antes de hacerlo.
        </p>
      </Block>

      <Block id="instalar" title="Instalar y actualizar la app">
        <p>
          Es una PWA: puedes <strong>instalarla</strong> desde el navegador (icono de instalar en
          la barra de direcciones, o menú &rarr; "Instalar app") y usarla como una app más, en PC y
          en el móvil.
        </p>
        <p>
          Cuando hay una versión nueva, al abrir la app aparece abajo el aviso{' '}
          <strong>"Hay una nueva versión de la app. Actualiza para aplicarla"</strong>: pulsa{' '}
          <strong>Actualizar</strong>. Si no aparece, cierra y vuelve a abrir la app instalada.
        </p>
      </Block>

      <Block id="faq" title="Preguntas frecuentes">
        <div className="space-y-2">
          <Faq q="¿Mis datos se suben a algún sitio?">
            No, salvo que actives la sincronización con cuenta. En modo local, todo se queda en tu
            dispositivo y la app funciona sin conexión.
          </Faq>
          <Faq q="¿Puedo usarla sin internet?">
            Sí. Una vez cargada, funciona offline. La conexión solo hace falta para actualizar la
            app o para la sincronización opcional.
          </Faq>
          <Faq q="¿Qué formatos de extracto acepta?">
            CSV, XLSX y XLS. No necesitas preparar el archivo: subes el que te da el banco y mapeas
            las columnas (o cargas la plantilla que guardaste).
          </Faq>
          <Faq q="¿Por qué mis ingresos o gastos salen inflados?">
            Suele ser por transferencias entre tus propias cuentas. Márcalas como transferencia
            desde la Bandeja de revisión y dejarán de contar.
          </Faq>
          <Faq q="¿Cómo empiezo de cero sin perder el histórico?">
            Exporta primero un backup desde Exportar. Luego, si borras los datos, podrás
            restaurarlo cuando quieras.
          </Faq>
          <Faq q="¿Cada perfil ve los datos de los demás?">
            No. Los perfiles están aislados: cada uno ve solo lo suyo.
          </Faq>
        </div>
      </Block>
    </section>
  );
}
