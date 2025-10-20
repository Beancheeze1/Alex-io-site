// pages/_app.js
function App({ Component, pageProps }) {
  return <Component {...pageProps} />;
}

// Opt-out of automatic static optimization (prevents pages-layer prerender path)
App.getInitialProps = async () => ({ pageProps: {} });

export default App;
