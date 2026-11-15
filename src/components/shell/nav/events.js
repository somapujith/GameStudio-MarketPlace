// Window events any screen can dispatch to drive hub chrome:
//   window.dispatchEvent(new Event('hub:open-code'))    opens the "Have a code?" sheet
//   window.dispatchEvent(new Event('hub:open-search'))  opens the command palette
export const OPEN_CODE_EVENT = 'hub:open-code';
export const OPEN_SEARCH_EVENT = 'hub:open-search';
