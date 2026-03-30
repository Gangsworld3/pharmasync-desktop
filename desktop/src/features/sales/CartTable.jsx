import ExpiryBadge from "../inventory/ExpiryBadge.jsx";
import Table from "../../components/shared/Table.jsx";

const columns = [
  { key: "name", label: "Medicine" },
  { key: "qty", label: "Qty" },
  { key: "expiry", label: "Expiry", render: (row) => <ExpiryBadge date={row.expiry} /> }
];

export default function CartTable({ items }) {
  return (
    <div className="card">
      <Table columns={columns} rows={items} />
    </div>
  );
}
