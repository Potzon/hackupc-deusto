import { useState } from 'react'

function App() {
  const [count, setCount] = useState(0)

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-100 text-gray-800">
      <h1 className="text-4xl font-bold mb-4 text-blue-600">Pear + React + Tailwind CSS</h1>
      <div className="bg-white p-8 rounded-lg shadow-md max-w-md w-full text-center">
        <p className="mb-4 text-lg">Haz click en el botón para probar el estado en React:</p>
        <button 
          className="px-4 py-2 bg-blue-500 text-white font-semibold rounded hover:bg-blue-600 transition"
          onClick={() => setCount((count) => count + 1)}
        >
          El contador es {count}
        </button>
      </div>
    </div>
  )
}

export default App
