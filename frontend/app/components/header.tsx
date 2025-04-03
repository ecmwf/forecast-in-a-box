
import React from 'react';
import { Container, Space, Image, Button, Group, Title} from '@mantine/core';

import { IconBox } from '@tabler/icons-react';


const Header = () => {

  return (
    <Container bg="#202036" fluid>
      <Space h="xl" />
      <Container size="xl">
        <Group justify="space-between">
          <a style={{"color":"white"}} href=""><IconBox/><h2></h2></a>
          <Title style={{"color":"white"}}>Forecast In a Box</Title>
          <Group gap={40}>
            <a href='/'>
              <Button radius={0} className="animated-button" bg="rgba(0, 0, 0, 0)" size="xl">Home</Button>
            </a>
            <a href='products'>
              <Button radius={0} className="animated-button" bg="rgba(0, 0, 0, 0)" size="xl">Products</Button>
            </a>
            <a href='jobs'>
              <Button radius={0} className="animated-button" bg="rgba(0, 0, 0, 0)" size="xl">Jobs</Button>
            </a>
          </Group>
        </Group>
      </Container>
      <Space h="xl" />
    </Container>
  )
}

export default Header;