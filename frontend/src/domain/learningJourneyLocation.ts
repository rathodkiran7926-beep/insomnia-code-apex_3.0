export function learningJourneyLocation(pathname: string, search: string) {
  const query = new URLSearchParams(search);
  if (pathname === '/journeys' && !query.has('section')) query.set('section', 'all');
  return (
    pathname.replace(/^\/journeys(?=\/|$)/, '/learn') + (query.size ? '?' + query.toString() : '')
  );
}
