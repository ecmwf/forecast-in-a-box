
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
          {/* <Group gap={40}>
            <a href='./products'>
              <Button radius={0} className="animated-button" bg="rgba(0, 0, 0, 0)" size="xl">products</Button>
            </a>
            <Button radius={0} className="animated-button" bg="rgba(0, 0, 0, 0)" size="xl">models</Button>
            <a href='https://earthkit.readthedocs.io/en/latest' target='_blank'>
              <Button radius={0} className="animated-button" bg="rgba(0, 0, 0, 0)" size="xl">account</Button>
            </a>
          </Group> */}
        </Group>
      </Container>
      <Space h="xl" />
    </Container>
  )
}

export default Header;