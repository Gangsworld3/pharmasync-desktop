import Modal from "../../components/shared/Modal.jsx";
import Input from "../../components/shared/Input.jsx";
import { t } from "../../i18n/i18n.js";

export default function AddStockModal({ open, onClose }) {
  return (
    <Modal open={open} title={t("addStock")} onClose={onClose}>
      <form className="stack">
        <Input label="Medicine" placeholder="Name" />
        <Input label="Quantity" type="number" min="1" />
        <Input label="Batch No" placeholder="B-001" />
        <Input label="Expiry" type="date" />
        <div className="row">
          <button type="button" onClick={onClose}>Close</button>
          <button type="submit">Save</button>
        </div>
      </form>
    </Modal>
  );
}
