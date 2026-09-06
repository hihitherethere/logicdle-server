# Point data
This document details the format of the different point type groups. Two points of the same groups can have different types. Points are integer where the unit digit is the type of the point. For maximal compability, the following fields must be filled with their respective expected values. Puzzles have an attribute called `types`, which must be filled as `[[Cells], [Vertices], [Edges], [Corners], [Compass]]` in that exact order, where `[Cells]`, for instance, is the array containing all the types of the cell group. By default, it is set to `[[0], [1], [2, 3, 4], [6], [5]]` as this is the pattern most currently implemented grid use. 

Points must be defined in the `create_points` function. This is where any helpers must be called, as well as defining the specific `types` for the grid.  
### Center/Cell
Cells that can be shaded, contain numbers, contain shapes, etc. Assuming the cell is `C`
  Subfield  |      Expected value      
:----------:|:-------------:|
`adjacent` |  Cells that are orthogonally connected to the cell `C`
`adjacent_dia` | Cells that have a vertex in common with `C`, but are not orthogonally adjacent 
`surround` | Vertices that are on the contour of the cell `C`
`neighbor` | Edges that make up the contour of the cell `C`
`edge_to_vertex` | Blank

### Vertex
Assuming the vertex is `V`
  Subfield  |      Expected value      
:----------:|:-------------:|
`adjacent` |  Opposite endpoints of all edges in `edge_to_vertex`
`adjacent_dia` | Vertices that are part of the contour of the cells around `V`, but are not connected by an edge to `V`
`surround` | Blank
`neighbor` | Cells for which `V` is one of their vertices
`edge_to_vertex` | Edges that are incident to `V`

### Edge
`type2` may be used for orientation. Assuming the edge is `E`
  Subfield  |      Expected value      
:----------:|:-------------:|
`adjacent` |  Edges that are parallel (or almost) which share a cell with `E`. These are used to draw walls. Usually of the same `type2` as `E` 
`adjacent_dia` | Blank
`surround` | Blank
`neighbor` | Cells for which `E` is one of their edges
`edge_to_vertex` | The vertices at both ends of `E`

### Corner
These are used for corner numbers and cage. These should usually be defined as a linear combination of a cell and a vertex. Assuming `C` is the corner
  Subfield  |      Expected value      
:----------:|:-------------:|
`adjacent` |  Corners that are either in a different cell than `C` but are neighbor to the same vertex, or corners that are in the same cell as `C`, and are neighbor to a vertex that is adjacent of the vertex of `C`
`adjacent_dia` | Blank
`surround` | Vertex of the cell that contains `C` closest to `C` (if pushed outwards, this would be where `C` ends up)
`neighbor` | Cell that contains `C`
`edge_to_vertex` | Blank

### Compass
These are used for compass clues, principally. These should usually be defined as a linear combination of a cell and an edge. Assuming `C` is the compass location
  Subfield  |      Expected value      
:----------:|:-------------:|
`adjacent` |  Blank
`adjacent_dia` | Blank
`surround` | Edge of the cell that contains `C` closest to `C` (if pushed outwards, this would be where `C` ends up)
`neighbor` | Cell that contains `C`
`edge_to_vertex` | Blank

## Helper functions

### `fix_points(point)`
Build some associations given the following are defined within `point`:
- Vertices and edges' coordinates.
- Cells' `surround` 
- Cells' `neighbor` (there can be incorrect edges, as long as all correct ones are present). 

The function will not build cells' `adjacent_dia`, vertices' `adjacent_dia`, edges' `adjacent` and all compass and corner attributes. Returns the updated point array.

### `point_connect_corners(point)`
Fill in the `adjacent` field of corners. `corner_table`, edges' `edge_to_vertex` and edges' `neighbor` must be filled beforehand. Returns the updated point array.

### `point_fillin_corners(point)`
Fill in the `neighbor` and `surround` field of corners. Cells' `surround` must be filled beforehand. Returns the updated point array.

### `create_corners(point, radius, k)`
Create corners with each of the cells, defined as a linear combination of the cells and their vertices (`radius` x coordinates of the cell + (1 - `radius`) x coordinates of the vertices). `k` is the current max point id. Returns `[point, k]`, where `k` is the new max `id` and `point` is the point array, with the added corners.
