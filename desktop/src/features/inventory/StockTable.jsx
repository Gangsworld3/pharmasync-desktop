import Table from "../../components/shared/Table.jsx";
import ExpiryBadge from "./ExpiryBadge.jsx";

const columns = [
  { key: "name", label: "Medicine" },
  { key: "stock", label: "Stock" },
  { key: "batch", label: "Batch" },
  { key: "expiry", label: "Expiry", render: (row) => <ExpiryBadge date={row.expiry} /> }
];

export default function StockTable({ rows }) {
  return (
    <div className="card">
      <Table columns={columns} rows={rows} />
    </div>
  );
}
