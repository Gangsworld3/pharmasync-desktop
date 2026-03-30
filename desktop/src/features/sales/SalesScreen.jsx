import ProductSearch from "./ProductSearch.jsx";
import CartTable from "./CartTable.jsx";
import PaymentPanel from "./PaymentPanel.jsx";

const sampleItems = [
  { id: "m1", name: "Paracetamol 500mg", qty: 1, expiry: "2026-08-10" },
  { id: "m2", name: "Amoxicillin 250mg", qty: 2, expiry: "2026-01-15" }
];

export default function SalesScreen() {
  return (
    <section className="sales">
      <ProductSearch />
      <CartTable items={sampleItems} />
      <PaymentPanel items={sampleItems} />
    </section>
  );
}
