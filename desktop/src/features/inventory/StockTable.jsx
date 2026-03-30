import Table from "../../components/shared/Table.jsx";
import ExpiryBadge from "./ExpiryBadge.jsx";

const columns = [
  { key: "name", label: "Medicine" },
  { key: "sku", label: "SKU" },
  { key: "quantityOnHand", label: "Stock" },
  { key: "batchNumber", label: "Batch", render: (row) => row.batchNumber ?? "-" },
  { key: "expiresOn", label: "Expiry", render: (row) => <ExpiryBadge date={row.expiresOn} /> },
  { key: "salePriceMinor", label: "Price", render: (row) => `$${(Number(row.salePriceMinor ?? 0) / 100).toFixed(2)}` },
  {
    key: "actions",
    label: "Actions",
    render: (row) => (
      <div className="row">
        <button type="button" onClick={() => row.onEdit(row)}>Edit</button>
        <button type="button" onClick={() => row.onAdjust(row, 1)}>+1</button>
        <button type="button" onClick={() => row.onAdjust(row, -1)}>-1</button>
      </div>
    )
  }
];

export default function StockTable({ rows, onEdit, onAdjust }) {
  const tableRows = rows.map((row) => ({ ...row, onEdit, onAdjust }));
  return (
    <div className="card">
      <Table columns={columns} rows={tableRows} />
    </div>
  );
}
