
import React from 'react';

import Header from './components/header';
import Products from './components/productSelect';


import './global.css';
import './page.module.css';
import { Container } from '@mantine/core';

const Homepage = () => {

  return (
    <>
      <Header />
      <Container size="xl">
      <Products/>
      </Container>
    </>
  )
}

export default Homepage;
