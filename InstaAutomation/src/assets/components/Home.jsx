import React, { useState } from 'react';
import './Home.css'; // Import the CSS file

function Home() {
  const [selectedFile, setSelectedFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [caption, setCaption] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleFileChange = (event) => {
    const file = event.target.files[0];
    setSelectedFile(file);
    setPreview(file ? URL.createObjectURL(file) : null);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!selectedFile) {
      alert("Please select an image first!");
      return;
    }

    setIsLoading(true);
    setCaption('');
    setError('');

    const formData = new FormData();
    formData.append('image', selectedFile);

    try {
      // Replace with your actual backend URL
      const response = await fetch('http://localhost:4000/generate-post', {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();

      if (response.ok) {
        setCaption(result.caption);
      } else {
        throw new Error(result.error || 'Something went wrong');
      }
    } catch (error) {
      console.error("Error:", error);
      setError(`Error: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="container">
      <h1>📸 Instagram Post Automator</h1>
      <form onSubmit={handleSubmit} className="upload-form">
        <input 
          type="file" 
          accept="image/jpeg, image/png" 
          onChange={handleFileChange}
          className="file-input"
        />
        {preview && <img src={preview} alt="Preview" style={{ maxWidth: '200px', marginTop: '10px', borderRadius: '4px' }} />}
        <button type="submit" disabled={isLoading || !selectedFile} className="submit-button">
          {isLoading ? 'Generating...' : 'Generate & Post'}
        </button>
      </form>

      {error && (
        <div style={{ marginTop: '20px', color: 'red' }}>
          <p>{error}</p>
        </div>
      )}

      {caption && (
        <div className="caption-container">
          <h2>Suggested Caption:</h2>
          <p>{caption}</p>
        </div>
      )}
    </div>
  );
}

export default Home;