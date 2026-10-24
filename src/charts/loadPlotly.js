/**
 * loadPlotly()
 * Lazily injects the Plotly bundle from `public/plotly.min.js` and resolves
 * once `window.Plotly` is ready. The script is requested only when a chart is
 * first rendered, so the initial app paint is never blocked by the ~4.8 MB
 * vendor file. Repeated calls share one promise (one script tag).
 *
 * The URL is built from import.meta.env.BASE_URL because vite.config.js uses
 * `base: './'` (the app is deployed under a sub-path on GitHub Pages).
 *
 * @returns {Promise<object>} The Plotly global.
 *
 * Example: loadPlotly().then(Plotly => Plotly.newPlot(node, data, layout))
 */
let plotlyPromise = null

export function loadPlotly() {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Plotly requires a browser environment'))
  }
  if (window.Plotly) return Promise.resolve(window.Plotly)

  if (!plotlyPromise) {
    plotlyPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script')
      script.src = `${import.meta.env.BASE_URL}plotly.min.js`
      script.async = true
      script.onload = () => {
        if (window.Plotly) resolve(window.Plotly)
        else reject(new Error('plotly.min.js loaded but window.Plotly is missing'))
      }
      script.onerror = () => reject(new Error('Could not load plotly.min.js'))
      document.head.appendChild(script)
    }).catch(error => {
      // Allow a later mount to retry if the first request failed.
      plotlyPromise = null
      throw error
    })
  }

  return plotlyPromise
}
