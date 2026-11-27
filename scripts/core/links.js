// scripts/core/links.js
//
// Where a link in text from the wallet file may lead: the web, mail, or this page.
// A wallet file can come from someone else, and a `javascript:` address in its
// notes would run as part of this page when clicked, which the page's policy
// cannot tell from the page's own code. Such a link keeps its text and loses its
// address.

const Links = (() => {
  const SAFE = ["http", "https", "mailto"];

  /**
   * Whether an address is plain web or mail; one without a scheme stays on this
   * page. Spaces and control characters, which browsers skip, do not hide a scheme.
   * @param {string} href
   */
  function isSafe(href) {
    const s = String(href ?? "").replace(/[\u0000-\u0020\u007f-\u009f]/g, "").toLowerCase();
    const scheme = s.match(/^([a-z][a-z0-9+.-]*):/)?.[1];
    return !scheme || SAFE.includes(scheme);
  }

  /** Every link inside `root` that leads anywhere else loses its address. @returns {Element} root */
  function defuse(root) {
    for(const a of root.querySelectorAll("a[href]")) {
      if(!isSafe(a.getAttribute("href"))) a.removeAttribute("href");
    }
    return root;
  }

  return { isSafe, defuse };
})();
