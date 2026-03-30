import { useState } from "react";
import AddStockModal from "./AddStockModal.jsx";
import StockTable from "./StockTable.jsx";

const sampleStock = [
  { id: "i1", name: "Panadol", stock: 120, batch: "B123", expiry: "2026-10-10" },
  { id: "i2", name: "Augmentin", stock: 30, batch: "B456", expiry: "2026-02-01" },
  { id: "i3", name: "Insulin", stock: 8, batch: "B789", expiry: "2025-01-01" }
];

export default function InventoryScreen() {
  const [open, setOpen] = useState(false);
  return (
    <section className="inventory">
      <button type="button" onClick={() => setOpen(true)}>Add Stock</button>
      <AddStockModal open={open} onClose={() => setOpen(false)} />
      <StockTable rows={sampleStock} />
    </section>
  );
}
