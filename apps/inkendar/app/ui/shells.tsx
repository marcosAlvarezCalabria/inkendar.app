import { useId, useRef } from "react";
import type { ReactNode } from "react";
import { Form, Link, useLocation } from "react-router";

import { BrandMark, StatusBadge } from "./feedback.js";
import { activeOwnerNavItem, isOwnerNavItemActive, ownerNavItems } from "./owner-nav.js";

const LOGOUT_FORM_ID = "session-logout";

/**
 * Private OWNER frame: compact header with a modal menu on small screens and a
 * persistent rail from 1024px. Visibility here is never an authorization control.
 */
export function OwnerShell({ title, description, action, children }: Readonly<{
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}>) {
  const { pathname } = useLocation();
  const menuId = `owner-menu-${useId().replace(/[^\w-]/gu, "")}`;
  const menuTitleId = `${menuId}-title`;
  const menuRef = useRef<HTMLDialogElement>(null);
  const current = activeOwnerNavItem(pathname);

  function openMenu() {
    const menu = menuRef.current;
    // Browsers with Invoker Commands open the dialog natively, even before hydration.
    if (menu && !menu.open && !("commandForElement" in HTMLButtonElement.prototype)) menu.showModal();
  }

  function closeMenu() {
    const menu = menuRef.current;
    if (menu?.open) menu.close();
  }

  return (
    <div className="app-frame" data-role="owner">
      <a className="skip-link" href="#contenido">Saltar al contenido</a>
      <header className="topbar">
        <Link className="brand-line" to="/app/owner"><BrandMark /> Inkendar</Link>
        <button
          className="button button-quiet menu-trigger"
          type="button"
          aria-haspopup="dialog"
          onClick={openMenu}
          {...{ command: "show-modal", commandfor: menuId }}
        >
          <span className="menu-glyph" aria-hidden="true" />
          Menú
        </button>
      </header>

      <aside className="rail">
        <Link className="brand-line" to="/app/owner"><BrandMark /> Inkendar</Link>
        <OwnerNavList pathname={pathname} label="Principal" />
        <Form className="rail-logout" id={LOGOUT_FORM_ID} method="post" action="/logout">
          <button className="button button-quiet" type="submit">Cerrar sesión</button>
        </Form>
      </aside>

      <dialog className="menu-sheet" id={menuId} ref={menuRef} aria-labelledby={menuTitleId} closedby="any">
        <div className="menu-sheet-head">
          <p className="menu-sheet-title" id={menuTitleId}>Menú</p>
          <button className="button button-quiet" type="button" onClick={closeMenu} {...{ command: "close", commandfor: menuId }}>
            Cerrar menú
          </button>
        </div>
        <OwnerNavList pathname={pathname} label="Principal" onNavigate={closeMenu} />
        <button className="button button-quiet menu-logout" type="submit" form={LOGOUT_FORM_ID}>Cerrar sesión</button>
      </dialog>

      <main className="workspace" id="contenido" tabIndex={-1}>
        <header className="page-header">
          {current && !current.exact ? (
            <nav className="breadcrumbs" aria-label="Ruta">
              <ol>
                <li><Link to="/app/owner">Panel</Link></li>
                <li><span aria-current="page">{current.label}</span></li>
              </ol>
            </nav>
          ) : null}
          <div className="page-heading">
            <div className="page-heading-text">
              <h1>{title}</h1>
              {description ? <p className="page-description">{description}</p> : null}
            </div>
            {action ? <div className="page-action">{action}</div> : null}
          </div>
        </header>
        <div className="workspace-body">{children}</div>
      </main>
    </div>
  );
}

function OwnerNavList({ pathname, label, onNavigate }: Readonly<{ pathname: string; label: string; onNavigate?: () => void }>) {
  return (
    <nav className="owner-nav-list" aria-label={label}>
      <ul>
        {ownerNavItems.map((item) => {
          const active = isOwnerNavItemActive(item, pathname);
          return (
            <li key={item.to}>
              <Link to={item.to} aria-current={active ? "page" : undefined} onClick={onNavigate}>{item.label}</Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Read-only ARTIST frame: no rail, no OWNER links and only the global logout. */
export function ArtistShell({ displayName, children }: Readonly<{ displayName: string; children: ReactNode }>) {
  return (
    <div className="app-frame" data-role="artist">
      <a className="skip-link" href="#contenido">Saltar al contenido</a>
      <header className="topbar topbar-static">
        <p className="brand-line"><BrandMark /> Inkendar</p>
        <Form method="post" action="/logout">
          <button className="button button-quiet" type="submit">Cerrar sesión</button>
        </Form>
      </header>
      <main className="workspace workspace-narrow" id="contenido" tabIndex={-1}>
        <header className="page-header">
          <div className="page-heading">
            <div className="page-heading-text">
              <h1>Hola, {displayName}</h1>
            </div>
            <StatusBadge tone="neutral">Solo lectura</StatusBadge>
          </div>
        </header>
        <div className="workspace-body">{children}</div>
      </main>
    </div>
  );
}

/**
 * Self-contained frame for opaque client links: discreet brand, one sheet and a
 * recovery hint. It never links to the private app or between public links.
 */
export function PublicLinkShell({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="public-frame">
      <header className="public-head">
        <p className="brand-line"><BrandMark /> Inkendar</p>
      </header>
      <main className="public-main">
        <div className="sheet public-sheet">{children}</div>
      </main>
      <footer className="public-foot">
        <p>Este enlace es personal. Si algo no cuadra, escribe al estudio por el canal de siempre.</p>
      </footer>
    </div>
  );
}
