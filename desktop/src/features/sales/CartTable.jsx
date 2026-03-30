import Table from "../../components/shared/Table.jsx";

function formatExpiry(value) {
  if (!value) return "n/a";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleDateString();
}

const columns = [
  { key: "name", label: "Medicine" },
  { key: "qty", label: "Qty" },
  { key: "unitPriceMinor", label: "Unit", render: (row) => `$${(row.unitPriceMinor / 100).toFixed(2)}` },
  { key: "expiry", label: "Expiry", render: (row) => formatExpiry(row.expiry) }
];

export default function CartTable({ items, onRemove }) {
  return (
    <div className="card">
      <div className="row between">
        <h3>Cart</h3>
        <span>{items.length} item(s)</span>
      </div>
      <Table columns={columns} rows={items} />
      {items.length > 0 && (
        <div className="stack">
          {items.map((item) => (
            <div key={item.id} className="row between">
              <span>{item.name} x {item.qty}</span>
              <button type="button" onClick={() => onRemove(item.id)}>Remove</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
