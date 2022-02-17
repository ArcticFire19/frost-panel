import svg from 'rollup-plugin-svg'

export default {
  entry: 'src/input.js',
  dest: 'dist/output.js',
  plugins: [
    svg()
  ]
}