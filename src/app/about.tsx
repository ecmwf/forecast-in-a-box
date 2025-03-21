import React from "react";
import { useParams } from "react-router-dom";

const AboutPage = () => {
  const { name } = useParams<{ name: string }>();

  return (
    <div>
      <h1>About {name}</h1>
      <p>This is the about page for {name}.</p>
    </div>
  );
};

export default AboutPage;