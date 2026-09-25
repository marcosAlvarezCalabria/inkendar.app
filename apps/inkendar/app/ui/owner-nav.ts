export type OwnerNavItem = Readonly<{
  to: string;
  label: string;
  exact: boolean;
}>;

/** Base order follows the operating flow: conversation → customer/case → calendar/offer → content. */
export const ownerNavItems: readonly OwnerNavItem[] = [
  { to: "/app/owner", label: "Panel", exact: true },
  { to: "/app/owner/conversations", label: "Conversaciones", exact: false },
  { to: "/app/owner/customers", label: "Clientes", exact: false },
  { to: "/app/owner/cases", label: "Casos", exact: false },
  { to: "/app/owner/calendars", label: "Calendario", exact: false },
  { to: "/app/owner/offers", label: "Ofertas", exact: false },
  { to: "/app/owner/gallery", label: "Galería", exact: false },
];

export function isOwnerNavItemActive(item: OwnerNavItem, pathname: string): boolean {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/u, "") : pathname;
  if (item.exact) return path === item.to;
  return path === item.to || path.startsWith(`${item.to}/`);
}

export function activeOwnerNavItem(pathname: string): OwnerNavItem | undefined {
  return ownerNavItems.find((item) => isOwnerNavItemActive(item, pathname));
}
