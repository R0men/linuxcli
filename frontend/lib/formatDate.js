// Без fs/node-залежностей навмисно — на відміну від changelogContent.js,
// цей хелпер потрібен і в server-компонентах (ChangelogView), і в
// client-компоненті HomeView, а client-бандл не може резолвити 'fs'.
export function formatChangelogDate(date) {
  return new Date(date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}
