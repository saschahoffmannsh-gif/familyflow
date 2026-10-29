// Rubber-band resistance stays gentle at the edge and bounded on long pulls.
export function elasticScrollOffset(distance:number,height:number) {
  const limit=Math.min(78,Math.max(42,height*.12))
  return Math.sign(distance)*limit*(1-Math.exp(-Math.abs(distance)/180))
}
