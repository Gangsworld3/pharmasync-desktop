export default function Badge({ children, type = "ok" }) {
  return <span className={`badge ${type}`}>{children}</span>;
}
