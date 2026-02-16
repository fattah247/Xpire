import { useEffect, useMemo, useState } from "react";
import "./App.css";

const API_BASE =
  import.meta.env.VITE_API_URL ||
  import.meta.env.REACT_APP_API_URL ||
  "http://localhost:4000";

function formatDate(dateText) {
  const date = new Date(dateText);
  if (Number.isNaN(date.getTime())) return "Invalid date";
  return date.toLocaleDateString();
}

function App({ autoLoad = true }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [form, setForm] = useState({
    name: "",
    category: "general",
    quantity: 1,
    expiresOn: "",
    notes: "",
  });

  async function loadItems(filter = statusFilter) {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`${API_BASE}/api/items?status=${filter}`);
      if (!response.ok) {
        throw new Error("Unable to load items from API");
      }
      const payload = await response.json();
      setItems(payload.items ?? []);
    } catch (fetchError) {
      setError(fetchError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!autoLoad) {
      return;
    }
    loadItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoLoad]);

  const summary = useMemo(() => {
    return items.reduce(
      (acc, item) => {
        acc[item.status] = (acc[item.status] || 0) + 1;
        return acc;
      },
      { fresh: 0, expiring: 0, expired: 0 }
    );
  }, [items]);

  async function onCreateItem(event) {
    event.preventDefault();
    setError("");

    if (!form.name.trim() || !form.expiresOn) {
      setError("Name and expiry date are required.");
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/api/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!response.ok) {
        const payload = await response.json();
        throw new Error(payload.error || "Failed to create item");
      }
      setForm({
        name: "",
        category: "general",
        quantity: 1,
        expiresOn: "",
        notes: "",
      });
      await loadItems(statusFilter);
    } catch (postError) {
      setError(postError.message);
    }
  }

  async function onDeleteItem(id) {
    try {
      const response = await fetch(`${API_BASE}/api/items/${id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        throw new Error("Failed to delete item");
      }
      await loadItems(statusFilter);
    } catch (deleteError) {
      setError(deleteError.message);
    }
  }

  function onFilterChange(nextFilter) {
    setStatusFilter(nextFilter);
    loadItems(nextFilter);
  }

  return (
    <main className="app-shell">
      <section className="hero">
        <h1>Xpire Expiry Tracker</h1>
        <p>
          Track household items and prioritize what to use before it expires.
        </p>
      </section>

      <section className="summary-grid" aria-label="Status summary">
        <article className="summary-card fresh">
          <h2>Fresh</h2>
          <p>{summary.fresh}</p>
        </article>
        <article className="summary-card expiring">
          <h2>Expiring Soon</h2>
          <p>{summary.expiring}</p>
        </article>
        <article className="summary-card expired">
          <h2>Expired</h2>
          <p>{summary.expired}</p>
        </article>
      </section>

      <section className="panel">
        <h2>Add Item</h2>
        <form className="item-form" onSubmit={onCreateItem}>
          <label>
            Name
            <input
              value={form.name}
              onChange={(event) =>
                setForm((current) => ({ ...current, name: event.target.value }))
              }
              placeholder="Eggs, yogurt, medicine..."
            />
          </label>
          <label>
            Category
            <input
              value={form.category}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  category: event.target.value,
                }))
              }
              placeholder="dairy, produce, pantry..."
            />
          </label>
          <label>
            Quantity
            <input
              type="number"
              min="1"
              value={form.quantity}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  quantity: Number(event.target.value),
                }))
              }
            />
          </label>
          <label>
            Expiry Date
            <input
              type="date"
              value={form.expiresOn}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  expiresOn: event.target.value,
                }))
              }
            />
          </label>
          <label className="notes-field">
            Notes
            <textarea
              value={form.notes}
              onChange={(event) =>
                setForm((current) => ({ ...current, notes: event.target.value }))
              }
              placeholder="Optional storage notes"
            />
          </label>
          <button type="submit">Save Item</button>
        </form>
      </section>

      <section className="panel">
        <div className="list-header">
          <h2>Tracked Items</h2>
          <div className="filters">
            {["all", "fresh", "expiring", "expired"].map((filter) => (
              <button
                key={filter}
                type="button"
                className={statusFilter === filter ? "active" : ""}
                onClick={() => onFilterChange(filter)}
              >
                {filter}
              </button>
            ))}
          </div>
        </div>

        {error ? <p className="error">{error}</p> : null}
        {loading ? <p>Loading...</p> : null}
        {!loading && items.length === 0 ? (
          <p>No items found for this filter.</p>
        ) : null}

        <ul className="item-list">
          {items.map((item) => (
            <li key={item.id} className={`item ${item.status}`}>
              <div>
                <h3>{item.name}</h3>
                <p>
                  {item.category} • Qty {item.quantity}
                </p>
                <p>Expires: {formatDate(item.expiresOn)}</p>
                <p>
                  {item.daysLeft < 0
                    ? `${Math.abs(item.daysLeft)} day(s) overdue`
                    : `${item.daysLeft} day(s) remaining`}
                </p>
              </div>
              <div className="actions">
                <span className="status">{item.status}</span>
                <button type="button" onClick={() => onDeleteItem(item.id)}>
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>
      <footer>
        API base: <code>{API_BASE}</code>
      </footer>
    </main>
  );
}

export default App;
