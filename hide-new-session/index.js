/**
 * Host half of the hide-new-session bundle.
 *
 * Nothing runs on the Host: the whole effect is one CSS rule that the Client
 * half injects. The row still exists so the bundle has an inventory entry and
 * the Client module has an owning fiber to attach to.
 */

/** No Host-side work. */
export function apply() {}
