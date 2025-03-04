
import React from 'react';
import { useState } from 'react';

import Header from './components/header';
import Products from './select';


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
