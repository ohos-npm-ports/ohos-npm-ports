import { useState } from 'react';

export default function Home({ message }) {
  const [count, setCount] = useState(0);
  return <main className="app">
    <h1>Overrides frontend</h1>
    <p>{message}</p>
    <button onClick={() => setCount(count + 1)}>Count: {count}</button>
  </main>;
}

export async function getServerSideProps() {
  return { props: { message: 'registry-overrides-ready' } };
}
