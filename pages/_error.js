// pages/_error.js
function ErrorPage({ statusCode }) {
  const code = statusCode ?? 500;
  return (
    <div style={{ padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      <h1>{code} — Error</h1>
      <p>Something went wrong.</p>
    </div>
  );
}

ErrorPage.getInitialProps = ({ res, err }) => {
  const statusCode = (res && res.statusCode) || (err && err.statusCode) || 500;
  return { statusCode };
};

export default ErrorPage;
