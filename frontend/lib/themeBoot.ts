// Shared with the server layout so its inline script is a plain string, rather
// than a reference to an export from a client component module.
export const THEME_KEY = "lexa.theme";

export const themeBootScript = `
(function(){try{
  var s=localStorage.getItem('${THEME_KEY}');
  if(s==='dark') document.documentElement.classList.add('dark');
}catch(e){}})();
`;
