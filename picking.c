/* Diagnostic port of SpaceApp memory-picking.ts at f0a2078. See LICENSE. */
typedef unsigned int u32;
typedef int i32;

__attribute__((import_module("math"), import_name("cos")))
extern double host_cos(double);
__attribute__((import_module("math"), import_name("sin")))
extern double host_sin(double);

static inline double smaller(double a, double b) { return a < b ? a : b; }
static inline double larger(double a, double b) { return a > b ? a : b; }

/* The caller validates and copies a trusted index once, with a stack slot for
 * every tree node. Inputs are finite and zoom is positive, as in the app. */
int pick_node(const float *points, const float *radii, const u32 *order,
              const float *bounds, const i32 *tree, i32 *stack, int tree_length,
              double yaw, double pitch, double zoom, double scale,
              double width, double height, double screen_x, double screen_y,
              int focus) {
    if (!tree_length) return -1;
    const double cy = host_cos(yaw), sy = host_sin(yaw);
    const double cp = host_cos(pitch), sp = host_sin(pitch);
    const double px = screen_x - width / 2, py = height / 2 - screen_y;
    const double zoom_scale = scale * zoom, root_zoom = __builtin_sqrt(zoom);
    stack[0] = 0;
    int remaining = 1, selected = -1;
    double best_depth = __builtin_inf();
    while (remaining) {
        const int id = stack[--remaining], at = id * 5;
        const double cx = bounds[at], yy = bounds[at + 1], zz = bounds[at + 2];
        const double radius = bounds[at + 3];
        const double x = cx * cy + zz * sy, d = -cx * sy + zz * cy;
        const double y = yy * cp - d * sp, z = yy * sp + d * cp;
        if (z - radius > best_depth) continue;
        const double near = 650 / larger(120, 650 + (z - radius) * scale);
        const double far = 650 / larger(120, 650 + (z + radius) * scale);
        const double padding = larger(7, bounds[at + 4] * near * root_zoom * 1.5 + 3);
        const double min_x = (x - radius) * zoom_scale, max_x = (x + radius) * zoom_scale;
        const double min_y = (y - radius) * zoom_scale, max_y = (y + radius) * zoom_scale;
        if (px < smaller(min_x * near, min_x * far) - padding ||
            px > larger(max_x * near, max_x * far) + padding ||
            py < smaller(min_y * near, min_y * far) - padding ||
            py > larger(max_y * near, max_y * far) + padding) continue;
        const int row = id * 4, left = tree[row + 2], right = tree[row + 3];
        if (left >= 0) {
            const int l = left * 5, r = right * 5;
            const double left_depth = bounds[l + 1] * sp + (-(double)bounds[l] * sy + bounds[l + 2] * cy) * cp;
            const double right_depth = bounds[r + 1] * sp + (-(double)bounds[r] * sy + bounds[r + 2] * cy) * cp;
            if (left_depth < right_depth) { stack[remaining++] = right; stack[remaining++] = left; }
            else { stack[remaining++] = left; stack[remaining++] = right; }
            continue;
        }
        for (int i = tree[row]; i < tree[row + 1]; i++) {
            const int node = (int)order[i], offset = node * 3;
            const double nx = points[offset] * cy + points[offset + 2] * sy;
            const double nd = -(double)points[offset] * sy + points[offset + 2] * cy;
            const double ny = points[offset + 1] * cp - nd * sp;
            const double nz = points[offset + 1] * sp + nd * cp;
            if (nz > best_depth) continue;
            const double perspective = 650 / larger(120, 650 + nz * scale);
            const double hit_radius = larger(7, larger(1, radii[node] * perspective * root_zoom) * (node == focus ? 1.5 : 1) + 3);
            const double dx = nx * zoom_scale * perspective - px;
            const double dy = ny * zoom_scale * perspective - py;
            if (dx * dx + dy * dy <= hit_radius * hit_radius &&
                (nz < best_depth || selected < 0 || node < selected)) {
                selected = node;
                best_depth = nz;
            }
        }
    }
    return selected;
}
