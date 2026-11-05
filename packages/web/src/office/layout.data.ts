/**
 * The office floor plan. Edit freely — every row in a block must be the same width.
 *
 * The office is built top to bottom from:
 *   HEADER     rooms + reception/lounge strip (always shown once)
 *   POD_ROW    a row of desk pods, repeated as more projects show up
 *   FOOTER     the bottom wall
 *
 * Legend — structure (blocks movement unless noted):
 *   #  wall              =  wall with window     D  entrance door (walkable, agents spawn here)
 *   .  wood floor        ,  carpet               :  server-room tiles
 *   B  bookshelf         R  server rack          T  meeting table
 *   M  mail shelves      K  coffee machine       S  sofa
 *   P  plant             F  filing cabinet       G  globe desk
 *   X  reception counter d  work desk            w  water cooler
 *
 * Legend — spots (walkable floor where agents stand or sit):
 *   l  library           r  server rack terminal m  mailroom
 *   g  globe desk        f  filing cabinet       t  meeting seat
 *   k  lounge sofa seat  x  reception (waiting on you)
 *   a b c  desk seat in pod 0 / 1 / 2 of a pod row
 */

export const HEADER = [
  "##==##==##==##==##==##=###==##==##==##==##=##",
  "#BBBBBBBBBBBB#RRRRRRRRR#P,,,,,,,,,,P#MMMMMMM#",
  "#,l,l,l,l,l,,#r:r:r:r:r#,,,,,,,,,,,,#m.m.m.m#",
  "#,,,,,,,,,,,,#:::::::::#,,tttttttt,,#.......#",
  "#,BBBB,,BBBB,#:RR:::RR:#,,TTTTTTTT,,#.......#",
  "#,l,l,,,,l,l,#:r:::::r:#,,TTTTTTTT,,#.......#",
  "#,,,,,,,,,,,,#:::::::::#,,tttttttt,,#.......#",
  "#P,,,,,,,,,,P#:::::::::#,,,,,,,,,,,,#P.....P#",
  "######..##########.##########..#########.####",
  "#.......................P...................#",
  "#..XXXXX...K.kkkk.kkkk....G.G.G...FFFFFFFFF.#",
  "D..xxxxx...k..............g.g.g...f.f.f.f.f.#",
  "D..x.x.x....................................#",
  "#.............kk..kk........................#",
  "#P...................w.....................P#",
  "#...........................................#",
];

export const POD_ROW = [
  "#...........................................#",
  "#..dd..dd..dd....dd..dd..dd....dd..dd..dd...#",
  "#..a...a...a.....b...b...b.....c...c...c....#",
  "#..............P.............P..............#",
  "#..dd..dd..dd....dd..dd..dd....dd..dd..dd...#",
  "#..a...a...a.....b...b...b.....c...c...c....#",
  "#...........................................#",
];

export const FOOTER = ["##==##==##==##==##==##==##==##==##==##==##=##"];

/** Pod rows shown even when the office is quiet, so it never looks empty. */
export const MIN_POD_ROWS = 2;
