// @skenion.uniform speed number.f32 default=0.5
@fragment
fn fs_main() -> @location(0) vec4<f32> {
  return vec4<f32>(skenion.missingField, 0.0, 0.0, 1.0);
}
