// Server Component: form HTML puro com auto-submit ao trocar BM (via script inline).
// Não depende de hidratação React, funciona com qualquer extensão do navegador.

interface FilterOption {
  value: string;
  label: string;
}

interface Props {
  businessManagers: FilterOption[];
  adAccounts: FilterOption[];
  currentValues: {
    period: string;
    bm: string;
    account: string;
    status: string;
    name?: string;
    sort?: string;
    order?: string;
  };
}

const PERIOD_OPTIONS: FilterOption[] = [
  { value: "today", label: "Hoje" },
  { value: "yesterday", label: "Ontem" },
  { value: "last_7d", label: "Últimos 7 dias" },
  { value: "last_14d", label: "Últimos 14 dias" },
  { value: "last_30d", label: "Últimos 30 dias" },
  { value: "last_90d", label: "Últimos 90 dias" },
];

const STATUS_OPTIONS: FilterOption[] = [
  { value: "all", label: "Todas" },
  { value: "active", label: "Só ativas" },
];

const FORM_ID = "filters-form";

export function Filters({
  businessManagers,
  adAccounts,
  currentValues,
}: Props) {
  return (
    <>
      <form
        id={FORM_ID}
        method="get"
        action="/"
        className="flex flex-wrap items-end gap-3"
      >
        <FilterSelect
          name="period"
          label="Período"
          defaultValue={currentValues.period}
          options={PERIOD_OPTIONS}
          accent
        />
        <FilterSelect
          name="bm"
          label="Business Manager"
          defaultValue={currentValues.bm}
          options={[{ value: "", label: "Todas as BMs" }, ...businessManagers]}
          dataAutoSubmit
        />
        <FilterSelect
          name="account"
          label="Conta de anúncio"
          defaultValue={currentValues.account}
          options={[{ value: "", label: "Todas as contas" }, ...adAccounts]}
        />
        <FilterSelect
          name="status"
          label="Status"
          defaultValue={currentValues.status}
          options={STATUS_OPTIONS}
        />

        <div className="flex flex-col gap-1">
          <label
            htmlFor="filter-name"
            className="text-xs text-zinc-500 uppercase tracking-wider"
          >
            Buscar por nome
          </label>
          <input
            id="filter-name"
            type="text"
            name="name"
            defaultValue={currentValues.name ?? ""}
            placeholder="ex: TESTE CRIATIVO"
            className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-600 min-w-[200px]"
          />
        </div>

        {currentValues.sort && (
          <input type="hidden" name="sort" value={currentValues.sort} />
        )}
        {currentValues.order && (
          <input type="hidden" name="order" value={currentValues.order} />
        )}

        <button
          type="submit"
          className="bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-100 font-medium px-4 py-2 rounded-lg transition-colors text-sm whitespace-nowrap"
        >
          Aplicar filtros
        </button>
      </form>

      {/* Auto-submit ao trocar BM: limpa account (pode ser de outra BM) e re-renderiza dropdown */}
      <script
        dangerouslySetInnerHTML={{
          __html: `
            (function() {
              var bmSelect = document.querySelector('select[data-auto-submit][name="bm"]');
              if (bmSelect) {
                bmSelect.addEventListener('change', function() {
                  var form = bmSelect.form;
                  if (!form) return;
                  // limpa account antes de submeter
                  var accSelect = form.querySelector('select[name="account"]');
                  if (accSelect) accSelect.value = '';
                  form.submit();
                });
              }
            })();
          `,
        }}
      />
    </>
  );
}

function FilterSelect({
  name,
  label,
  defaultValue,
  options,
  accent,
  dataAutoSubmit,
}: {
  name: string;
  label: string;
  defaultValue: string;
  options: FilterOption[];
  accent?: boolean;
  dataAutoSubmit?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label
        htmlFor={`filter-${name}`}
        className="text-xs text-zinc-500 uppercase tracking-wider"
      >
        {label}
      </label>
      <select
        id={`filter-${name}`}
        name={name}
        defaultValue={defaultValue}
        {...(dataAutoSubmit ? { "data-auto-submit": "" } : {})}
        className={`bg-zinc-900 border rounded-lg px-3 py-2 text-sm focus:outline-none min-w-[180px] ${
          accent
            ? "border-blue-600/40 focus:border-blue-500"
            : "border-zinc-800 focus:border-blue-600"
        }`}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}
