
import React from 'react';
import { Container, Space, Image, Button, Group, Title} from '@mantine/core';

import { IconBox } from '@tabler/icons-react';


const Header = () => {

  return (
    <Container bg="#202036" fluid w='100vw'>
      <Space h="xl" />
        <Group justify="space-between">
          <Group>
            <a style={{"color":"white"}} href="/"><IconBox/></a>
            <Title style={{"color":"white"}}>ECMWF Forecast In a Box</Title>
          </Group>
          <Group>
            <Button radius={0} className="animated-button" bg="rgba(0, 0, 0, 0)" size="md" component='a' href='/'>Home</Button>
            <Button radius={0} className="animated-button" bg="rgba(0, 0, 0, 0)" size="md" component='a' href='/products'>Products</Button>
            <Button radius={0} className="animated-button" bg="rgba(0, 0, 0, 0)" size="md" component='a' href='/status'>Status</Button>
          </Group>
        </Group>
      <Space h="md" />
    </Container>
  )
}

export default Header;