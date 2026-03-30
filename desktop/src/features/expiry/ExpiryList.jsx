import ExpiryBadge from "../inventory/ExpiryBadge.jsx";

export default function ExpiryList({ rows }) {
  return (
    <div className="card">
      {rows.map((row) => (
        <div key={row.id} className="row between">
          <strong>{row.name}</strong>
          <ExpiryBadge date={row.date} />
        </div>
      ))}
    </div>
  );
}
