import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';

function App() {
  const [count, setCount] = useState(0);
  return <main className="app">
    <h1>Overrides frontend</h1>
    <p>registry-overrides-ready</p>
    <button onClick={() => setCount(count + 1)}>Count: {count}</button>
  </main>;
}
createRoot(document.getElementById('app')).render(<App />);
