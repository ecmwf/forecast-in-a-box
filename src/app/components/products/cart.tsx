
import React, { useState } from 'react';
import { Button, ActionIcon, ScrollArea, Card, Text, Group, Modal, Divider } from '@mantine/core';

import Configuration from './configuration';
import { IconX, IconPencil} from '@tabler/icons-react';

const Cart = ({ products, setProducts }) => {
  
    const handleRemove = (id) => {
      const updatedProducts = { ...products };
      delete updatedProducts[id];
      setProducts(updatedProducts);
    };

    const [modalOpen, setModalOpen] = useState(false);
    const [selectedProduct, setSelectedProduct] = useState(null);
    
    const openModal = (id) => {
      setSelectedProduct(id);
      setModalOpen(true);
    };

    const handleEdit = (value) => {
        setModalOpen(false);
        handleRemove(selectedProduct);
        setProducts((prev) => ({
          ...prev,
          [selectedProduct]: value,
        }));
      };

    console.log(products);
  
    const rows = Object.keys(products).map((id) => (
        <>
        <Card padding='xs' shadow='xs' radius='md' key={id}>
            <Card.Section w='100%'>
                <Group justify='space-between' mt="xs" mb="xs">
                    <Text size='xl'>{products[id].product}</Text>
                    <Group>
                    <ActionIcon color="green" onClick={() => openModal(id)} size="lg"><IconPencil/></ActionIcon>
                    <ActionIcon color="red" onClick={() => handleRemove(id)} size="lg"><IconX/></ActionIcon>
                    </Group>
                </Group>
            </Card.Section>
            <Modal opened={modalOpen} onClose={() => setModalOpen(false)} title="Edit">
                {selectedProduct !== null && (
                    <Configuration apiPath="/api/py/products/configuration" selected={products[selectedProduct]} submitTarget={handleEdit}  /> //initial={products[selectedProduct]}
                )}
            </Modal>
            {/* <Text size='sm' c='dimmed'>
                {JSON.stringify(products[id], (key, value) => key === 'product' ? undefined : value)}
            </Text> */}
      </Card>
       <Divider my="md" />
       </>
    ));
    
    return (
      <Card shadow="sm" padding="lg" radius="md" withBorder h="70vh" w="25vw" mih="300px">
        <ScrollArea h='inherit'>
          {rows}
        </ScrollArea>        
      </Card>
    );
  };
  

  export default Cart;