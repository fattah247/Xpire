import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import App from "./App";

describe("App", () => {
  test("renders the expiry tracker dashboard", async () => {
    render(<App autoLoad={false} />);
    expect(await screen.findByText(/xpire expiry tracker/i)).toBeInTheDocument();
    expect(screen.getByText(/add item/i)).toBeInTheDocument();
    expect(screen.getByText(/no items found for this filter/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save item/i })).toBeInTheDocument();
  });
});
