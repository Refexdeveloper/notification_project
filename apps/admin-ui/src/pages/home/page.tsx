import { Navigate } from 'react-router-dom';

/** Legacy home route — Applications is the product root. */
export default function Home() {
  return <Navigate to="/applications" replace />;
}
